# Rota PWA (`rota/`)

A separate front end for the rota system, with its own domain (e.g. `rota.<domain>`), its own
deployment and its own installable PWA. It has **no backend of its own**: it signs in and
reads and writes everything through the **main app's** `/api/rota`.

```
rota.<domain>/<slug>  ──fetch + Bearer──►  <main app>/api/rota/*  ──►  lib/rota-service.ts  ──►  Supabase
                                            (same code the main app's rota screens use)
```

## How people get in

1. The restaurant's link: `https://rota.<domain>/<restaurant-slug>` (the same slug as the main
   app's customer/staff links).
2. They pick their name and enter the **same 4-digit PIN** as the main app. The same lockout
   applies: 5 wrong tries lock the account for 30 minutes.
3. People with `view_payroll` / `manage_payroll` (and owners) get **Rota / Wages / My Rota**.
   Everyone else gets **My Rota** only. The backend enforces this on every call; the tabs
   only avoid offering what it would refuse.

The device remembers the last restaurant, so the installed app opens straight back to it.

## Code layout

| Where | What |
| --- | --- |
| `rota/` | The PWA: `app/` (pages, manifest, offline), `components/` (PIN pad, shell), `lib/api.ts` (tokens + fetch), `lib/rota-fetch-api.ts`, `public/sw.js` + icons |
| `components/rota/*` | The rota screens, **shared** by both apps (board, shift editor, wages, My Rota view) |
| `components/rota/rota-api.tsx` | The `RotaApi` adapter the screens call. The main app plugs in server actions (`server-actions-api.tsx`); the PWA plugs in fetch |
| `lib/rota-service.ts` | The rota server logic, taking the caller as an argument |
| `app/actions/rota.ts` | Main app's thin server-action wrappers (cookie session) |
| `app/api/rota/[...path]/route.ts` | The PWA's API (bearer token), with CORS |
| `lib/auth/pin-login.ts` · `lib/auth/bearer.ts` · `lib/api/cors.ts` | Shared PIN check · token → staff · CORS allow-list |

`rota/` has **no `package.json` and no `node_modules`**. It runs from the repo root's
`node_modules` (`next dev rota`), so the shared components and the app load one copy of React.
Don't add dependencies inside `rota/`; add them to the root.

## Run it locally

```bash
# main app — its .env.local needs:  ROTA_APP_ORIGINS=http://localhost:3001
npm run dev                 # :3000
# rota app — rota/.env.local needs:  NEXT_PUBLIC_MAIN_API_URL=http://localhost:3000
npm run rota:dev            # :3001  → http://localhost:3001/<slug>
```

## Deploy (second Coolify app, same repo)

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run rota:build` |
| Start command | `npm run rota:start` (port 3001) |
| Domain | `rota.<domain>` |
| Env (rota app) | `NEXT_PUBLIC_MAIN_API_URL=https://<main app domain>`. Baked in at build time, so a change needs a rebuild |
| Env (main app) | `ROTA_APP_ORIGINS=https://rota.<domain>` (comma-separated). Without it, browsers block every call. `NEXT_PUBLIC_ROTA_APP_URL=https://rota.<domain>` shows each restaurant's rota link on Super Admin → Restaurant (needs a rebuild) |

The rota app is a different origin from the main app, so neither app's PWA, service worker or
storage interferes with the other.

## Known limits (v1)

- **No realtime stream**: the screens refetch when the app regains focus and every 60 seconds.
  An SSE stream would need the token in a URL.
- Tokens live in the browser's `localStorage`, per restaurant. "Sign out" clears them on that
  device only.
- Stronger access control (a second PIN, device approval) is planned and not built.
