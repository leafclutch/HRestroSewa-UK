// The Rota PWA's line to the main app's backend (/api/rota on the main domain).
//
// Sign-in is the main app's own staff PIN; what comes back is a Supabase access +
// refresh token pair, kept here in localStorage PER RESTAURANT (one device can be
// signed into one person per restaurant). Every call sends the access token as a
// bearer header; a 401 triggers ONE refresh and a retry, and if that fails too the
// person is signed out and shown the PIN pad again.

const BASE = `${(process.env.NEXT_PUBLIC_MAIN_API_URL ?? "").replace(/\/+$/, "")}/api/rota`;

export type Tokens = { access_token: string; refresh_token: string; expires_at: number | null };

export type RestaurantInfo = {
  name: string;
  logoUrl: string | null;
  currency: string;
  payoutMode: "standard" | "advanced";
  staff: { id: string; display_name: string; title: string | null; role: string }[];
};

export type Me = {
  id: string;
  display_name: string;
  role: string;
  canView: boolean;
  canManage: boolean;
  restaurant: { slug: string | null; name: string; currency: string; payoutMode: "standard" | "advanced" };
};

/** Thrown when the session is gone for good; the screen goes back to the PIN pad. */
export class SignedOutError extends Error {
  constructor() {
    super("Signed out");
  }
}

const LAST_SLUG = "rota.lastSlug";
const tokenKey = (slug: string) => `rota.tokens.${slug}`;

// Storage can throw (private mode, blocked site data) — never let that break the app.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // signed in for this tab only
  }
}

export const lastSlug = () => read(LAST_SLUG);
export const rememberSlug = (slug: string) => write(LAST_SLUG, slug);

export function loadTokens(slug: string): Tokens | null {
  const raw = read(tokenKey(slug));
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Tokens;
    return t.access_token && t.refresh_token ? t : null;
  } catch {
    return null;
  }
}
export const saveTokens = (slug: string, t: Tokens | null) =>
  write(tokenKey(slug), t ? JSON.stringify(t) : null);

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

// ── Public ───────────────────────────────────────────────────────────────────

/** null when the restaurant does not exist (or is inactive). */
export async function fetchRestaurant(slug: string): Promise<RestaurantInfo | null> {
  const res = await fetch(`${BASE}/restaurant/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  return json<RestaurantInfo>(res);
}

/** Signs in with the staff PIN; throws with the server's message on failure. */
export async function pinLogin(slug: string, staffId: string, pin: string): Promise<Tokens> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, restaurant_user_id: staffId, pin }),
  });
  const t = await json<Tokens>(res);
  saveTokens(slug, t);
  return t;
}

// ── Signed in ────────────────────────────────────────────────────────────────

export type RotaClient = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: FormData | Record<string, unknown>) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  signOut: () => void;
};

export function createRotaClient(slug: string, onSignedOut: () => void): RotaClient {
  let refreshing: Promise<boolean> | null = null;

  const signOut = () => {
    saveTokens(slug, null);
    onSignedOut();
  };

  // One refresh at a time: a screen firing three requests on a stale token must not
  // spend the single-use refresh token three times.
  const refresh = () => {
    if (!refreshing) {
      refreshing = (async () => {
        const t = loadTokens(slug);
        if (!t) return false;
        const res = await fetch(`${BASE}/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: t.refresh_token }),
        }).catch(() => null);
        if (!res?.ok) return false;
        saveTokens(slug, (await res.json()) as Tokens);
        return true;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const send = () => {
      const t = loadTokens(slug);
      if (!t) return null;
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${t.access_token}`);
      return fetch(`${BASE}/${path}`, { ...init, headers, cache: "no-store" });
    };

    // Refresh ahead of time when the token is about to lapse, rather than eating a 401.
    const t = loadTokens(slug);
    if (t?.expires_at && t.expires_at * 1000 - Date.now() < 60_000) await refresh();

    let res = await send();
    if (res?.status === 401 && (await refresh())) res = await send();
    if (!res || res.status === 401) {
      signOut();
      throw new SignedOutError();
    }
    return json<T>(res);
  }

  return {
    get: (path) => call(path),
    post: (path, body) =>
      body instanceof FormData
        ? call(path, { method: "POST", body })
        : call(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    del: (path) => call(path, { method: "DELETE" }),
    signOut,
  };
}
