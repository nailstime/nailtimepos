import { requireStaff } from "../_shared/staff-auth.ts"
import { corsHeaders, json } from "../_shared/http.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405)

  try {
    const { order_id } = await req.json()
    const { admin, staff } = await requireStaff(req)
    const { data: order, error } = await admin
      .from("orders")
      .select("total,branch_id,member_id,members(line_user_id,points_balance,accumulated_baht)")
      .eq("id", order_id)
      .eq("branch_id", staff.branch_id)
      .eq("status", "paid")
      .single()

    if (error) throw error
    if (!order?.member_id || !order.members?.line_user_id) {
      return json(req, { skipped: "no_member_or_line" })
    }

    const { data: thresholdRow } = await admin
      .from("settings")
      .select("value")
      .eq("branch_id", staff.branch_id)
      .eq("key", "point_threshold_baht")
      .single()

    const threshold = Number(thresholdRow?.value ?? 1500)
    const member = order.members
    const toNext = Math.max(0, threshold - Number(member.accumulated_baht))
    const text =
      `✅ ชำระเงินเรียบร้อย\n` +
      `ยอดชำระ ฿${Number(order.total).toLocaleString("th-TH")}\n` +
      `สะสมอีก ฿${toNext.toLocaleString("th-TH")} รับ 1 สิทธิ์\n` +
      `สิทธิ์คงเหลือ: ${member.points_balance} สิทธิ์\n\n` +
      "ขอบคุณที่ใช้บริการ Nail Time & Spa 💅"

    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify({ to: member.line_user_id, messages: [{ type: "text", text }] }),
    })

    if (!response.ok) throw new Error(`LINE push failed (${response.status})`)
    return json(req, { ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes("unauthorized") || message.includes("session") ? 401 : 400
    return json(req, { error: message }, status)
  }
})
