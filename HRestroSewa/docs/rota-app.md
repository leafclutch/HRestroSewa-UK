# Rota PWA (`rota/`)

The repository holds **two separately deployed apps**, side by side:

```
HRestroSewa-UK/            ← git root
├── HRestroSewa/           ← main app (POS, admin, staff, superadmin) + the backend
└── rota/                  ← Rota PWA: front end only, its own package.json / node_modules
```

The rota app has **no backend of its own**. It signs in and reads/writes everything through the
main app's `/api/rota`:

```
rota.<domain>/<slug>  ──fetch + Bearer──►  <main app>/api/rota/*  ──►  lib/rota-service.ts  ──►  Supabase
                                            (same code the main app's rota screens use)
```

## How people get in

1. The restaurant's link: `https://rota.<domain>/<restaurant-slug>`. Super Admin → Restaurant shows
   it as "ROTA APP".
2. They pick their name and enter the **same 4-digit PIN** as the main app. The same lockout
   applies: 5 wrong tries lock the account for 30 minutes.
3. People with `view_payroll` / `manage_payroll` (and owners) get **Rota / Wages / My Rota**.
   Everyone else gets **My Rota** only. The backend enforces this on every call.

## What lives where

| Where | What |
| --- | --- |
| `HRestroSewa/lib/rota-service.ts` | The rota server logic, taking the caller as an argument. The ONLY implementation of the rules |
| `HRestroSewa/app/actions/rota.ts` | Main app's server actions (cookie session), thin wrappers |
| `HRestroSewa/app/api/rota/[...path]/route.ts` | The rota app's API (bearer token), with CORS |
| `HRestroSewa/lib/auth/pin-login.ts` · `bearer.ts` · `lib/api/cors.ts` | Shared PIN check · token → staff · CORS allow-list |
| `HRestroSewa/components/rota/*` | The rota screens as the main app renders them |
| `rota/components/rota/*`, `rota/components/ui/*`, `rota/lib/*`, `rota/app/globals.css` | The rota app's **own COPY** of those screens, UI pieces, helpers and styles |
| `rota/components/{rota-app,pin-login,rota-home,theme-switch,register-sw}.tsx`, `rota/lib/{api,rota-fetch-api}.ts` | Rota-app-only code: shell, PIN pad, token handling, fetch transport |

### ⚠️ The copied files must be kept in step

Each app deploys on its own, so `rota/` carries copies of 19 files from the main app. Every copy
starts with `// COPY of HRestroSewa/…`, and every original starts with
`// NOTE: the Rota app … carries its own COPY of this file`. **Change one, change the other.**
The server rules are NOT copied; they live only in the main app, so permissions and money logic
cannot drift. Only the look can.

## Run locally

```bash
cd HRestroSewa && npm run dev      # :3000. .env.local needs ROTA_APP_ORIGINS=http://localhost:3001
cd rota        && npm run dev      # :3001. rota/.env.local needs NEXT_PUBLIC_MAIN_API_URL=http://localhost:3000
# → http://localhost:3001/<slug>
```

Each folder has its own `npm install`.

## Deploy: two Coolify apps from the same repository

| | Main app | Rota app |
| --- | --- | --- |
| **Base directory** | `HRestroSewa` | `rota` |
| Build | `npm ci && npm run build` | `npm ci && npm run build` |
| Start | `npm run start` | `npm run start` (port 3001) |
| Domain | `<main domain>` | `rota.<domain>` |
| Env | existing vars, plus `ROTA_APP_ORIGINS=https://rota.<domain>` and `NEXT_PUBLIC_ROTA_APP_URL=https://rota.<domain>` | `NEXT_PUBLIC_MAIN_API_URL=https://<main domain>` |

⚠️ **The existing main-app Coolify app must have its base directory changed to `HRestroSewa`**,
because the app no longer sits at the repo root. Without that, the next deploy finds no
`package.json` and fails.

`NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a rebuild, not a restart.
The rota app pins its workspace root to its own folder (`rota/next.config.ts`), so its build never
reaches into `HRestroSewa/`.

## Known limits (v1)

- **No realtime stream**: the screens refetch when the app regains focus and every 60 seconds.
- Tokens live in the browser's `localStorage`, per restaurant. "Sign out" clears this device only.
- Stronger access control (a second PIN, device approval) is planned and not built.
