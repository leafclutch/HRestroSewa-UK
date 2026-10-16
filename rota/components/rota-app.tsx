"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, LogOut, UserRound, Wallet } from "lucide-react";
import { CurrencyProvider, useCurrency } from "@/components/currency-provider";
import { RotaApiProvider } from "@/components/rota/rota-api";
import { RotaBoard } from "@/components/rota/rota-board";
import { RotaPayroll } from "@/components/rota/rota-payroll";
import { MyRotaView } from "@/components/rota/my-rota-view";
import type { RotaPayrollSheet, RotaWeek } from "@/lib/rota";
import type { MyRota } from "@/lib/rota-service";
import {
  createRotaClient,
  fetchRestaurant,
  loadTokens,
  rememberSlug,
  SignedOutError,
  type Me,
  type RestaurantInfo,
  type RotaClient,
} from "@rota/lib/api";
import { createFetchRotaApi, fetchMyRota } from "@rota/lib/rota-fetch-api";
import { PinLogin } from "./pin-login";
import { ThemeSwitch } from "./theme-switch";

// /<slug>: the restaurant's rota. Signed out → the name picker and PIN pad.
// Signed in → owners and payroll staff get the board, the wages and their own week;
// everyone else gets their own week only. What each person may SEE or DO is decided by
// the main app's backend on every call — the tabs here only avoid offering what it
// would refuse.

type Tab = "rota" | "pay" | "mine";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-dvh px-4 py-5 sm:px-6"
      style={{ background: "var(--color-canvas-soft)", paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-md rounded-xl border p-6"
      style={{ boxShadow: "var(--shadow-card)", background: "var(--color-canvas)", borderColor: "var(--color-hairline-strong)" }}
    >
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-center py-10" style={{ color: "var(--color-ink-mute)" }}>
      {children}
    </p>
  );
}

export function RotaApp({ slug }: { slug: string }) {
  const [info, setInfo] = useState<RestaurantInfo | null | undefined>(undefined);
  const [infoError, setInfoError] = useState<string | null>(null);
  // Bumped on sign-in/out so the token in storage is re-read.
  const [session, setSession] = useState(0);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    rememberSlug(slug);
    fetchRestaurant(slug)
      .then(setInfo)
      .catch((e) => setInfoError(e instanceof Error ? e.message : "Could not reach the server."));
  }, [slug]);

  useEffect(() => {
    setSignedIn(loadTokens(slug) !== null);
  }, [slug, session]);

  const client = useMemo(
    () => createRotaClient(slug, () => setSession((n) => n + 1)),
    [slug]
  );

  if (infoError) {
    return (
      <Shell>
        <Card>
          <Note>{infoError}</Note>
        </Card>
      </Shell>
    );
  }
  if (info === undefined || signedIn === null) {
    return (
      <Shell>
        <Note>Loading…</Note>
      </Shell>
    );
  }
  if (info === null) {
    return (
      <Shell>
        <Card>
          <Note>This rota link doesn&apos;t match a restaurant. Check the link with your manager.</Note>
        </Card>
      </Shell>
    );
  }

  return (
    <CurrencyProvider code={info.currency}>
      <Shell>
        <header className="mb-4 sm:mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1
              className="text-xl sm:text-2xl truncate"
              style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
            >
              {info.name}
            </h1>
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
              Rota
            </p>
          </div>
          <ThemeSwitch />
        </header>

        {info.payoutMode !== "advanced" ? (
          <Card>
            <Note>This restaurant isn&apos;t using rota payroll. Ask your admin to switch it on.</Note>
          </Card>
        ) : !signedIn ? (
          <Card>
            <PinLogin slug={slug} staff={info.staff} onSignedIn={() => setSession((n) => n + 1)} />
          </Card>
        ) : (
          <SignedIn key={session} slug={slug} client={client} />
        )}
      </Shell>
    </CurrencyProvider>
  );
}

function SignedIn({ slug, client }: { slug: string; client: RotaClient }) {
  const api = useMemo(() => createFetchRotaApi(client), [client]);
  const [me, setMe] = useState<Me | null>(null);
  const [week, setWeek] = useState<RotaWeek | null>(null);
  const [sheet, setSheet] = useState<RotaPayrollSheet | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const who = await client.get<Me>("me");
        // A token from another restaurant's link must not open this one.
        if (who.restaurant.slug !== slug) {
          client.signOut();
          return;
        }
        if (!alive) return;
        setMe(who);
        if (who.canView) {
          setTab("rota");
          const [w, s] = await Promise.all([api.getWeek(null), api.getSheet(null)]);
          if (!alive) return;
          setWeek(w);
          setSheet(s);
        }
      } catch (e) {
        if (alive && !(e instanceof SignedOutError)) {
          setError(e instanceof Error ? e.message : "Could not load the rota.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, client, slug]);

  if (error) return <Note>{error}</Note>;
  if (!me) return <Note>Loading…</Note>;

  const tabs: { id: Tab; label: string; Icon: typeof Wallet }[] = me.canView
    ? [
        { id: "rota", label: "Rota", Icon: CalendarDays },
        { id: "pay", label: "Wages", Icon: Wallet },
        { id: "mine", label: "My Rota", Icon: UserRound },
      ]
    : [{ id: "mine", label: "My Rota", Icon: UserRound }];

  return (
    <RotaApiProvider api={api}>
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div
          className="flex sm:inline-flex w-full sm:w-auto rounded-lg p-0.5"
          role="tablist"
          style={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline-strong)", boxShadow: "var(--shadow-card)" }}
        >
          {tabs.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-md text-sm transition-colors"
                style={{
                  background: active ? "var(--color-primary)" : "transparent",
                  color: active ? "var(--color-on-primary, #ffffff)" : "var(--color-ink-mute)",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.12), 0 2px 8px -2px color-mix(in srgb, var(--color-primary) 55%, transparent)" : "none",
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={14} strokeWidth={1.5} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 min-w-0">
          <span className="text-sm truncate" style={{ color: "var(--color-ink-mute)" }}>
            Signed in as <span style={{ color: "var(--color-ink)" }}>{me.display_name}</span>
          </span>
          <button
            type="button"
            onClick={() => client.signOut()}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border shrink-0"
            style={{ boxShadow: "var(--shadow-card)", borderColor: "var(--color-hairline-strong)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>

      {me.canView && (
        <>
          {/* Kept mounted so switching tabs keeps the week/period you were on. */}
          <div hidden={tab !== "rota"}>
            {week ? <RotaBoard initial={week} canManage={me.canManage} /> : <Note>Loading…</Note>}
          </div>
          <div hidden={tab !== "pay"}>
            {sheet ? <RotaPayroll initial={sheet} canManage={me.canManage} /> : <Note>Loading…</Note>}
          </div>
        </>
      )}
      <div hidden={tab !== "mine"}>
        <MyWeek client={client} />
      </div>
    </RotaApiProvider>
  );
}

function MyWeek({ client }: { client: RotaClient }) {
  const cur = useCurrency();
  const [rota, setRota] = useState<MyRota | null | undefined>(undefined);
  const [week, setWeek] = useState<string | null>(null);

  const load = useCallback(
    (w: string | null) => {
      fetchMyRota(client, w)
        .then(setRota)
        .catch(() => {
          // keep the last known week on a transient failure
        });
    },
    [client]
  );

  useEffect(() => load(week), [load, week]);
  // Same live-refresh contract as the board: back to the foreground, or once a minute.
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") load(week);
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    const timer = setInterval(run, 60_000);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      clearInterval(timer);
    };
  }, [load, week]);

  if (rota === undefined) return <Note>Loading…</Note>;
  if (rota === null) return <Note>No rota for you yet.</Note>;

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Your shifts for the week. Times may be subject to change.
      </p>
      <MyRotaView
        rota={rota}
        money={rota.estimatedPay != null ? cur.money2 : null}
        weekLink={(w, content, attrs) => (
          <button type="button" onClick={() => setWeek(w)} {...attrs}>
            {content}
          </button>
        )}
      />
    </div>
  );
}
