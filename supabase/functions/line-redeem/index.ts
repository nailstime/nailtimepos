import { requireStaff } from "../_shared/staff-auth.ts"
import { corsHeaders, json } from "../_shared/http.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405)
  try {
    const { redemption_id } = await req.json()
    const { admin, staff } = await requireStaff(req)
    const { data: redemption, error } = await admin
      .from("redemptions")
      .select("id,points_cost_snapshot,rewards(name),members(line_user_id),orders!inner(branch_id,status)")
      .eq("id", redemption_id)
      .eq("orders.branch_id", staff.branch_id)
      .eq("orders.status", "awaiting_payment")
      .single()
    if (error) throw error
    if (!redemption?.members?.line_user_id) return json(req, { skipped: "member_has_no_line" })

    const liffUrl = Deno.env.get("LIFF_URL")
    if (!liffUrl) throw new Error("LIFF_URL is not configured")
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify({
        to: redemption.members.line_user_id,
        messages: [{
          type: "template",
          altText: `ยืนยันใช้ ${redemption.points_cost_snapshot} สิทธิ์ แลก ${redemption.rewards.name}`,
          template: {
            type: "buttons",
            text: `ยืนยันใช้ ${redemption.points_cost_snapshot} สิทธิ์\nแลก: ${redemption.rewards.name}`,
            actions: [{ type: "uri", label: "ยืนยันในหน้าสมาชิก", uri: liffUrl }],
          },
        }],
      }),
    })
    if (!response.ok) throw new Error(`LINE push failed (${response.status})`)
    return json(req, { ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.includes("unauthorized") || message.includes("session") ? 401 : 400
    return json(req, { error: message }, status)
  }
})
