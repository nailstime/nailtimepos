export function corsHeaders(req: Request) {
  const configuredOrigin = Deno.env.get("APP_ORIGIN")
  const requestOrigin = req.headers.get("origin") ?? ""
  return {
    "Access-Control-Allow-Origin": configuredOrigin || requestOrigin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  }
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) })
}
