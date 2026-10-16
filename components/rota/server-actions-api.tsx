"use client";

import type { ComponentProps } from "react";
import {
  copyPreviousWeek,
  deleteShift,
  getHourlyRates,
  getRotaPayrollSheet,
  getRotaWeek,
  recordRotaPayment,
  saveShift,
  setHourlyRate,
  undoCopyWeek,
} from "@/app/actions/rota";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { RotaApiProvider, type RotaApi } from "./rota-api";
import { RotaPayout } from "./rota-payout";

// The main app's transport for the shared rota screens: server actions over the
// cookie session, live updates from the realtime stream. (The Rota PWA supplies its
// own, over /api/rota.)
const SERVER_ACTIONS_API: RotaApi = {
  getWeek: getRotaWeek,
  saveShift,
  deleteShift,
  copyWeek: copyPreviousWeek,
  undoCopy: undoCopyWeek,
  getRates: getHourlyRates,
  setRate: setHourlyRate,
  getSheet: getRotaPayrollSheet,
  recordPayment: recordRotaPayment,
  useLiveRefresh: useRealtime,
};

/** `RotaPayout` wired to the main app's backend. */
export function MainRotaPayout(props: ComponentProps<typeof RotaPayout>) {
  return (
    <RotaApiProvider api={SERVER_ACTIONS_API}>
      <RotaPayout {...props} />
    </RotaApiProvider>
  );
}
