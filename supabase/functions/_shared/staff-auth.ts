import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.110.7"

type Staff = { id: string; branch_id: string; role: "owner" | "technician"; active: boolean }

export async function requireStaff(req: Request): Promise<{ admin: SupabaseClient; staff: Staff }> {
  const url = Deno.env.get("SUPABASE_URL")
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const authorization = req.headers.get("Authorization")
  if (!url || !publishableKey || !serviceKey || !authorization) throw new Error("unauthorized")

  const caller = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) throw new Error("unauthorized")

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: session, error: sessionError } = await admin
    .from("staff_sessions")
    .select("expires_at, staff:staff_id(id,branch_id,role,active)")
    .eq("auth_user_id", userData.user.id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  const staff = session?.staff as unknown as Staff | null
  if (sessionError || !staff?.active) throw new Error("staff_session_expired")
  return { admin, staff }
}
