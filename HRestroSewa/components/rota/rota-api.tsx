"use client";

// NOTE: the Rota app (../rota, deployed separately) carries its own COPY of this file.
// Keep the two in step: a change made here should be made there too.

import { createContext, useContext, type ReactNode } from "react";
import type { HourlyRate, RotaPayrollSheet, RotaWeek } from "@/lib/rota";
import type { Topic } from "@/lib/realtime/use-realtime";

// How the shared rota screens reach the backend.
//
// The board, the shift editor and the wages sheet are rendered by TWO apps: the main
// app (Admin → Staff, /employee/payroll) and the separate Rota PWA (`rota/`). The
// screens are identical; only the transport differs — server actions with the cookie
// session here, bearer-token fetches to /api/rota there. Each app provides one of
// these, and the components never import a transport themselves.
//
// The signatures deliberately match the server actions in app/actions/rota.ts, so
// `useFormSubmit(api.saveShift, …)` works unchanged on either side.

export type RotaResult = { error: string } | null;

export type RotaApi = {
  getWeek: (week?: string | null) => Promise<RotaWeek | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveShift: (prev: any, formData: FormData) => Promise<RotaResult>;
  deleteShift: (staffId: string, date: string) => Promise<RotaResult>;
  /** `ids` = the rows the copy created, which is what Undo removes. */
  copyWeek: (week: string) => Promise<{ error: string } | { copied: number; ids: string[] }>;
  /** Removes copied rows still untouched since the copy; edited ones are kept. */
  undoCopy: (ids: string[]) => Promise<{ error: string } | { removed: number; kept: number }>;
  getRates: (staffId: string) => Promise<HourlyRate[]>;
  setRate: (staffId: string, rate: string, from: string) => Promise<RotaResult>;
  getSheet: (day?: string | null) => Promise<RotaPayrollSheet | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordPayment: (prev: any, formData: FormData) => Promise<RotaResult>;
  /**
   * Re-run `onChange` when the data may have moved elsewhere. A HOOK, called once per
   * screen: the main app wires it to the realtime stream, the PWA to focus + polling.
   */
  useLiveRefresh: (topics: Topic[], onChange: () => void) => void;
};

const RotaApiContext = createContext<RotaApi | null>(null);

export function RotaApiProvider({ api, children }: { api: RotaApi; children: ReactNode }) {
  return <RotaApiContext.Provider value={api}>{children}</RotaApiContext.Provider>;
}

export function useRotaApi(): RotaApi {
  const api = useContext(RotaApiContext);
  if (!api) throw new Error("useRotaApi: wrap the rota screens in <RotaApiProvider>.");
  return api;
}
