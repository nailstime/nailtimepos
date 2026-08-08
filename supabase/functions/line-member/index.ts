import { createClient } from "npm:@supabase/supabase-js@2.110.7"
import { corsHeaders, json } from "../_shared/http.ts"

function clientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()
}

async function verifyLineIdToken(idToken: string) {
  const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID")
  if (!channelId || !idToken) throw new Error("line_identity_missing")
  const body = new URLSearchParams({ id_token: idToken, client_id: channelId })
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) throw new Error("invalid_line_id_token")
  const profile = await response.json()
  if (!profile?.sub || profile.aud !== channelId || profile.iss !== "https://access.line.me") {
    throw new Error("invalid_line_identity")
  }
  return profile as { sub: string; name?: string }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serviceKey) return json(req, { error: "server_not_configured" }, 503)
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Rate limit อยู่ใน Postgres เพื่อให้คุมข้าม Edge isolate ได้จริง ไม่ใช่แค่ memory ของ instance เดียว
  const { data: limited, error: limitError } = await admin.rpc("consume_line_member_rate_limit", {
    p_key: `line-member:${clientIp(req)}`,
    p_limit: 20,
    p_window_seconds: 60,
  })
  if (limitError) {
    console.error("line-member rate limit unavailable", { message: limitError.message })
    return json(req, { error: "rate_limit_unavailable" }, 503)
  }
  if (limited) return json(req, { error: "too_many_requests" }, 429)

  try {
    const body = await req.json()
    const profile = await verifyLineIdToken(String(body.id_token || ""))

    if (body.action === "me") {
      const { data, error } = await admin.rpc("line_get_member", { p_line_user_id: profile.sub })
      if (error) throw error
      return json(req, { data })
    }
    if (body.action === "register") {
      const { data, error } = await admin.rpc("line_register_member", {
        p_branch_code: Deno.env.get("DEFAULT_BRANCH_CODE") || "MAIN",
        p_name: String(body.name || profile.name || "").trim(),
        p_phone: String(body.phone || ""),
        p_line_user_id: profile.sub,
        p_claim_code: body.claim_code ? String(body.claim_code) : null,
      })
      if (error) throw error
      return json(req, { result: data })
    }
    if (body.action === "confirm_redemption") {
      const { data, error } = await admin.rpc("line_confirm_redemption", {
        p_redemption: body.redemption_id,
        p_line_user_id: profile.sub,
      })
      if (error) throw error
      return json(req, { result: data })
    }
    if (body.action === "rewards") {
      const branchCode = Deno.env.get("DEFAULT_BRANCH_CODE") || "MAIN"
      const { data: branch } = await admin.from("branches").select("id").eq("code", branchCode).single()
      if (!branch) return json(req, { data: [] })
      const { data, error } = await admin.from("rewards")
        .select("name, points_cost, description")
        .eq("branch_id", branch.id)
        .eq("active", true)
        .eq("terminated", false)
        .order("points_cost")
      if (error) throw new Error("rewards_unavailable")
      return json(req, { data: data ?? [] })
    }
    return json(req, { error: "invalid_action" }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("line-member request rejected", { message })
    const status = message.includes("identity") || message.includes("token") ? 401 : 400
    return json(req, { error: message }, status)
  }
})
