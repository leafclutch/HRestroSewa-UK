// CORS for the API the separate Rota PWA calls (app/api/rota/*).
//
// Only origins listed in ROTA_APP_ORIGINS (comma-separated, e.g.
// "https://rota.example.com,http://localhost:3001") are answered with CORS
// headers; any other origin gets none, so a browser on a random site cannot read the
// responses. No cookies are involved — auth is a bearer token — so credentials mode
// is never enabled.

function allowedOrigins(): string[] {
  return (process.env.ROTA_APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** A JSON response carrying the request's CORS headers. */
export function corsJson(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

/** The answer to a preflight. */
export function corsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
