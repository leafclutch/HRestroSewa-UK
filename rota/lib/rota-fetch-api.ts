"use client";

import { useEffect, useRef } from "react";
import type { RotaApi } from "@/components/rota/rota-api";
import type { HourlyRate, RotaPayrollSheet, RotaWeek } from "@/lib/rota";
import type { MyRota } from "@/lib/rota";
import type { RotaClient } from "./api";

// The PWA's transport for the shared rota screens: the same calls the main app makes
// as server actions, sent to /api/rota with the bearer token instead.

const q = (v: string | null | undefined) => (v ? encodeURIComponent(v) : "");

/**
 * No realtime stream across origins in v1 (it would need the token in a URL). The
 * screens refetch when the app comes back to the foreground, and every minute while
 * it is open — a rota changes a few times a day, not a few times a second.
 */
function useFocusRefresh(_topics: unknown, onChange: () => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    const timer = setInterval(run, 60_000);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      clearInterval(timer);
    };
  }, []);
}

export function createFetchRotaApi(client: RotaClient): RotaApi {
  return {
    getWeek: (week) => client.get<RotaWeek | null>(`week?week=${q(week)}`),
    saveShift: (_prev, formData) => client.post("shift", formData),
    deleteShift: (staffId, date) => client.del(`shift?staff=${q(staffId)}&date=${q(date)}`),
    copyWeek: (week) => client.post("copy-week", { week }),
    undoCopy: (ids) => client.post("undo-copy", { ids }),
    getRates: (staffId) => client.get<HourlyRate[]>(`rates?staff=${q(staffId)}`),
    setRate: (staffId, rate, from) => client.post("rate", { staff: staffId, rate, from }),
    getSheet: (day) => client.get<RotaPayrollSheet | null>(`sheet?day=${q(day)}`),
    recordPayment: (_prev, formData) => client.post("payment", formData),
    useLiveRefresh: useFocusRefresh,
  };
}

export const fetchMyRota = (client: RotaClient, week: string | null) =>
  client.get<MyRota | null>(`my?week=${q(week)}`);
