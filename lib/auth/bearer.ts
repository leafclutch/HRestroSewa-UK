import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getStaffRow, type StaffRow } from "@/lib/auth/current-user";

// Who is calling, for the Rota PWA's API. That app lives on another origin, so it
// cannot carry the main app's session cookies; it sends the Supabase access token it
// got from /api/rota/login as `Authorization: Bearer …` instead.
//
// The token only says WHO. Whether they still work here is the live staff-row check
// (`getStaffRow` — is_active + deleted_at, never cached across requests), the same one
// every cookie request goes through, so deactivating someone cuts the PWA off too.

/** A client that never persists anything: tokens arrive per request and leave with it. */
export function statelessSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** The verified auth user id behind the request's bearer token, or null. */
async function authUserId(token: string): Promise<string | null> {
  const supabase = statelessSupabase();
  // Local signature check where the project's keys allow it; otherwise getClaims
  // itself falls back to asking Auth.
  // It THROWS on a token that isn't even a JWT ("Invalid UTF-8 sequence") rather
  // than returning an error, so a garbage header must not become a 500.
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (!error) return (data?.claims?.sub as string | undefined) ?? null;
  } catch {
    // fall through to the server check below
  }
  // A failure to VERIFY is not an answer of "no" — ask the Auth server directly,
  // as getAuthUser does for the cookie path.
  const { data: u } = await supabase.auth.getUser(token);
  return u.user?.id ?? null;
}

/** The caller as staff, or null when the token is missing, invalid, expired or not staff. */
export async function staffFromBearer(request: Request): Promise<StaffRow | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const sub = await authUserId(token);
  if (!sub) return null;
  return getStaffRow(sub);
}
