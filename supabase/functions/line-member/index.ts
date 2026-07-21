import { createClient } from "npm:@supabase/supabase-js@2.110.7"
import { corsHeaders, json } from "../_shared/http.ts"

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
  try {
    const body = await req.json()
    const profile = await verifyLineIdToken(String(body.id_token || ""))
    const url = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !serviceKey) throw new Error("server_not_configured")
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

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
    return json(req, { error: "invalid_action" }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes("identity") || message.includes("token") ? 401 : 400
    return json(req, { error: message }, status)
  }
})
