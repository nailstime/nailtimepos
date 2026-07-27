import { createClient } from "npm:@supabase/supabase-js@2.110.7"
import { corsHeaders, json } from "../_shared/http.ts"

const SLOT_MINUTES = 15
// Last appointment may begin at 18:00 and can occupy slots until 19:30.
const LAST_START_MINUTES = 18 * 60

function clientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number)
  return hour * 60 + minute
}

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`
}

function bangkokNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) }
}

async function verifyLineIdToken(idToken: string) {
  const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID")
  if (!channelId || !idToken) throw new Error("line_identity_missing")
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  })
  if (!response.ok) throw new Error("invalid_line_id_token")
  const profile = await response.json()
  if (!profile?.sub || profile.aud !== channelId || profile.iss !== "https://access.line.me") throw new Error("invalid_line_identity")
  return profile as { sub: string; name?: string }
}

function normalizeServiceIds(value: unknown) {
  const ids = Array.isArray(value) ? value : [value]
  return Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)))
}

async function getBookableSlots(admin: ReturnType<typeof createClient>, date: string, requestedServiceIds: unknown) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_date")
  const serviceIds = normalizeServiceIds(requestedServiceIds)
  if (!serviceIds.length) throw new Error("service_required")
  const { data: services, error: serviceError } = await admin
    .from("services").select("id, name, duration, price").in("id", serviceIds).eq("is_active", true).eq("is_bookable", true)
  if (serviceError || !services || services.length !== serviceIds.length) throw new Error("service_not_found")

  const [{ data: slots, error: slotsError }, { data: bookings, error: bookingsError }] = await Promise.all([
    admin.from("time_slots").select("id, slot_date, start_time, capacity").eq("slot_date", date).eq("is_active", true).order("start_time"),
    admin.from("bookings").select("start_time, end_time").eq("slot_date", date).in("status", ["pending", "confirmed"]),
  ])
  if (slotsError || bookingsError) throw new Error("availability_unavailable")

  const slotRows = slots ?? []
  const slotMap = new Map(slotRows.map((slot) => [timeToMinutes(slot.start_time), slot]))
  const totalDuration = services.reduce((sum, service) => sum + Number(service.duration), 0)
  const slotCount = Math.max(1, Math.ceil(totalDuration / SLOT_MINUTES))
  const now = bangkokNow()
  const minimumStart = date === now.date ? Math.ceil(now.minutes / SLOT_MINUTES) * SLOT_MINUTES : null

  const bookable = slotRows.reduce<Array<Record<string, unknown>>>((result, slot) => {
    const start = timeToMinutes(slot.start_time)
    if (start > LAST_START_MINUTES || (minimumStart !== null && start < minimumStart)) return result
    const required = Array.from({ length: slotCount }, (_, index) => slotMap.get(start + index * SLOT_MINUTES))
    if (required.some((entry) => !entry)) return result
    const remaining = required.map((requiredSlot) => {
      const minute = timeToMinutes(requiredSlot!.start_time)
      const occupied = (bookings ?? []).filter((booking) => {
        const bookedStart = timeToMinutes(booking.start_time)
        const bookedEnd = timeToMinutes(booking.end_time)
        return bookedStart <= minute && bookedEnd > minute
      }).length
      return requiredSlot!.capacity - occupied
    })
    const available = Math.min(...remaining)
    if (available <= 0) return result
    result.push({
      id: slot.id, slot_date: date, start_time: slot.start_time,
      end_time: minutesToTime(start + slotCount * SLOT_MINUTES), capacity: slot.capacity, available,
    })
    return result
  }, [])

  return { serviceIds, services, slots: bookable }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serviceKey) return json(req, { error: "server_not_configured" }, 503)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: limited, error: limitError } = await admin.rpc("consume_line_member_rate_limit", {
    p_key: `booking-liff:${clientIp(req)}`, p_limit: 30, p_window_seconds: 60,
  })
  if (limitError) return json(req, { error: "rate_limit_unavailable" }, 503)
  if (limited) return json(req, { error: "too_many_requests" }, 429)

  try {
    const body = await req.json()
    const profile = await verifyLineIdToken(String(body.id_token || ""))

    if (body.action === "services") {
      const { data, error } = await admin.from("services")
        .select("id, name, duration, price").eq("is_active", true).eq("is_bookable", true).order("sort_order")
      if (error) throw new Error("services_unavailable")
      return json(req, { data: data ?? [] })
    }

    if (body.action === "slots") {
      const result = await getBookableSlots(admin, String(body.date || ""), body.service_ids ?? body.service_id)
      return json(req, { data: result.slots })
    }

    if (body.action === "book") {
      const slotId = String(body.slot_id || "")
      const date = String(body.date || "")
      const phone = String(body.guest_phone || "").replace(/\D/g, "")
      if (!/^\d{10}$/.test(phone)) return json(req, { error: "invalid_phone" }, 400)
      const result = await getBookableSlots(admin, date, body.service_ids ?? body.service_id)
      const selectedSlot = result.slots.find((slot) => slot.id === slotId)
      if (!selectedSlot) return json(req, { error: "selected_slot_unavailable" }, 409)
      const { data, error } = await admin.from("bookings").insert({
        service_id: result.serviceIds[0],
        service_ids: result.serviceIds.length > 1 ? result.serviceIds : null,
        slot_id: slotId,
        slot_date: selectedSlot.slot_date,
        start_time: selectedSlot.start_time,
        end_time: selectedSlot.end_time,
        guest_name: String(body.guest_name || profile.name || "").trim() || null,
        guest_phone: phone,
        guest_line_uid: profile.sub,
        note: String(body.note || "").trim() || null,
        status: "pending",
      }).select("booking_no, slot_date, start_time, end_time").single()
      if (error) throw new Error("booking_create_failed")
      return json(req, { data })
    }

    return json(req, { error: "invalid_action" }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("booking-liff request rejected", { message })
    const status = message.includes("identity") || message.includes("token") ? 401 : 400
    return json(req, { error: message }, status)
  }
})
