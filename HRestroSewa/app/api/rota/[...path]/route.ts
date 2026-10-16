// The backend for the separate Rota PWA (the `rota/` app at the repo root).
//
// That app is a pure front end on another origin: it signs in here with the staff
// PIN, keeps the access token itself, and sends it back as `Authorization: Bearer`.
// Everything after sign-in runs the SAME code as the main app's rota screens
// (lib/rota-service.ts) with the caller resolved from the token instead of a cookie,
// so permissions, tenancy and the advanced-payout check cannot differ between the two.
//
//   public   GET  restaurant/<slug>   name, logo, currency, payout mode, staff picker
//   public   POST login               { slug, restaurant_user_id, pin } → tokens
//   public   POST refresh             { refresh_token } → tokens
//   bearer   GET  me
//   bearer   GET  week?week=   POST shift (form)   DELETE shift?staff=&date=   POST copy-week
//                                                                          POST undo-copy { ids }
//   bearer   GET  rates?staff= POST rate           GET  sheet?day=   POST payment (form)
//   bearer   GET  my?week=

import { createServiceClient } from "@/lib/supabase/service";
import { attemptPinLogin } from "@/lib/auth/pin-login";
import { staffFromBearer, statelessSupabase } from "@/lib/auth/bearer";
import { corsJson, corsPreflight } from "@/lib/api/cors";
import { PAYROLL_ACCESS } from "@/lib/permissions";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { normalizeCurrency } from "@/lib/currency";
import { normalizePayoutMode } from "@/lib/payout-mode";
import type { StaffRow } from "@/lib/auth/current-user";
import type { Session } from "@supabase/supabase-js";
import {
  copyPreviousWeekFor,
  deleteShiftFor,
  hourlyRatesFor,
  myRotaFor,
  payrollSheetFor,
  recordPaymentFor,
  rotaWeekFor,
  saveShiftFor,
  setHourlyRateFor,
  undoCopyWeekFor,
} from "@/lib/rota-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const tokens = (s: Session) => ({
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_at: s.expires_at ?? null,
});

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

// ─── Public ──────────────────────────────────────────────────────────────────

async function restaurantBySlug(request: Request, slug: string) {
  if (!slug || slug.length > 100) return corsJson(request, { error: "Restaurant not found." }, 404);
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("id, name, logo_url, settings")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!rest) return corsJson(request, { error: "Restaurant not found." }, 404);

  // Only what the sign-in screen needs: who can pick their name. Knowing this grants
  // nothing — a PIN is still required — and it is what the main /login already shows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id, display_name, title, role")
    .eq("restaurant_id", rest.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_name");

  return corsJson(request, {
    name: rest.name,
    logoUrl: rest.logo_url ?? null,
    currency: normalizeCurrency(rest.settings?.currency),
    payoutMode: normalizePayoutMode(rest.settings),
    staff: staff ?? [],
  });
}

async function login(request: Request) {
  const body = await readJson(request);
  const slug = str(body.slug);
  const staffId = str(body.restaurant_user_id);
  const pin = str(body.pin);
  if (!slug || !staffId) return corsJson(request, { error: "Choose your name first." }, 400);

  // The PIN pad was opened for ONE restaurant; refuse a staff id from any other, so a
  // rota link can never be used to sign into a different restaurant's account.
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (service as any)
    .from("restaurant_users")
    .select("id, restaurants!inner ( slug )")
    .eq("id", staffId)
    .eq("restaurants.slug", slug)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member) return corsJson(request, { error: "Staff member not found." }, 404);

  const attempt = await attemptPinLogin(statelessSupabase(), staffId, pin);
  if ("error" in attempt) return corsJson(request, { error: attempt.error }, 401);
  if (!attempt.session) {
    return corsJson(request, { error: "Signed in, but no session came back. Please try again." }, 500);
  }
  return corsJson(request, tokens(attempt.session));
}

async function refresh(request: Request) {
  const body = await readJson(request);
  const refreshToken = str(body.refresh_token);
  if (!refreshToken) return corsJson(request, { error: "Signed out." }, 401);
  const { data, error } = await statelessSupabase().auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data.session) return corsJson(request, { error: "Signed out." }, 401);
  return corsJson(request, tokens(data.session));
}

// ─── Signed in ───────────────────────────────────────────────────────────────

async function me(request: Request, ru: StaffRow) {
  const service = createServiceClient();
  const [config, slugRes] = await Promise.all([
    getRestaurantConfig(ru.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).from("restaurants").select("slug").eq("id", ru.restaurant_id).maybeSingle(),
  ]);
  return corsJson(request, {
    id: ru.id,
    display_name: ru.display_name,
    role: ru.role,
    canView: PAYROLL_ACCESS.canViewPayroll(ru),
    canManage: PAYROLL_ACCESS.canManagePayroll(ru),
    restaurant: {
      slug: slugRes.data?.slug ?? null,
      name: config.name,
      currency: config.currency,
      payoutMode: config.payoutMode,
    },
  });
}

async function signedIn(request: Request, route: string, ru: StaffRow): Promise<Response | null> {
  const q = new URL(request.url).searchParams;
  const method = request.method;
  const ok = (body: unknown) => corsJson(request, body);

  if (method === "GET") {
    switch (route) {
      case "me":
        return me(request, ru);
      case "week":
        return ok(await rotaWeekFor(ru, q.get("week")));
      case "rates":
        return ok(await hourlyRatesFor(ru, q.get("staff") ?? ""));
      case "sheet":
        return ok(await payrollSheetFor(ru, q.get("day")));
      case "my":
        return ok(await myRotaFor(ru, q.get("week")));
    }
  }
  if (method === "POST") {
    switch (route) {
      case "shift":
        return ok(await saveShiftFor(ru, await request.formData()));
      case "payment":
        return ok(await recordPaymentFor(ru, await request.formData()));
      case "copy-week": {
        const body = await readJson(request);
        return ok(await copyPreviousWeekFor(ru, str(body.week)));
      }
      case "undo-copy": {
        const body = await readJson(request);
        return ok(await undoCopyWeekFor(ru, body.ids));
      }
      case "rate": {
        const body = await readJson(request);
        return ok(await setHourlyRateFor(ru, str(body.staff), str(body.rate), str(body.from)));
      }
    }
  }
  if (method === "DELETE" && route === "shift") {
    return ok(await deleteShiftFor(ru, q.get("staff") ?? "", q.get("date") ?? ""));
  }
  return null;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const path = (await ctx.params).path ?? [];
  const route = path[0] ?? "";

  try {
    if (request.method === "GET" && route === "restaurant") {
      return await restaurantBySlug(request, path[1] ?? "");
    }
    if (request.method === "POST" && route === "login") return await login(request);
    if (request.method === "POST" && route === "refresh") return await refresh(request);

    const ru = await staffFromBearer(request);
    if (!ru) return corsJson(request, { error: "Signed out." }, 401);

    const res = await signedIn(request, route, ru);
    return res ?? corsJson(request, { error: "Not found." }, 404);
  } catch (e) {
    console.error(`[api/rota] ${request.method} ${path.join("/")}:`, e);
    return corsJson(request, { error: "Something went wrong. Please try again." }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export function OPTIONS(request: Request) {
  return corsPreflight(request);
}
