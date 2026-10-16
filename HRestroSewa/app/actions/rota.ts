"use server";

// Advanced payout — the main app's front door to the rota. The logic lives in
// lib/rota-service.ts, which takes the caller as an argument so the separate Rota
// PWA's API (app/api/rota/[...path]) can run exactly the same code. Here the caller
// is the cookie session; every permission and tenancy check happens in the service.

import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
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
  type CopyWeekResult,
  type MyRota,
  type RotaResult,
} from "@/lib/rota-service";
import type { HourlyRate, RotaPayrollSheet, RotaWeek } from "@/lib/rota";

export type { CopyWeekResult, MyRota, RotaResult } from "@/lib/rota-service";

export async function getRotaWeek(week?: string | null): Promise<RotaWeek | null> {
  return rotaWeekFor(await getRestaurantUser(), week);
}

export async function saveShift(_prev: RotaResult, formData: FormData): Promise<RotaResult> {
  return saveShiftFor(await getRestaurantUser(), formData);
}

export async function deleteShift(staffId: string, date: string): Promise<RotaResult> {
  return deleteShiftFor(await getRestaurantUser(), staffId, date);
}

export async function copyPreviousWeek(week: string): Promise<CopyWeekResult> {
  return copyPreviousWeekFor(await getRestaurantUser(), week);
}

export async function undoCopyWeek(ids: string[]): Promise<{ error: string } | { removed: number; kept: number }> {
  return undoCopyWeekFor(await getRestaurantUser(), ids);
}

export async function getHourlyRates(staffId: string): Promise<HourlyRate[]> {
  return hourlyRatesFor(await getRestaurantUser(), staffId);
}

export async function setHourlyRate(
  staffId: string,
  rateRaw: string,
  fromRaw: string
): Promise<RotaResult> {
  return setHourlyRateFor(await getRestaurantUser(), staffId, rateRaw, fromRaw);
}

export async function getRotaPayrollSheet(day?: string | null): Promise<RotaPayrollSheet | null> {
  return payrollSheetFor(await getRestaurantUser(), day);
}

export async function recordRotaPayment(
  _prev: RotaResult,
  formData: FormData
): Promise<RotaResult> {
  return recordPaymentFor(await getRestaurantUser(), formData);
}

export async function getMyRota(week?: string | null): Promise<MyRota | null> {
  return myRotaFor(await getRestaurantUser(), week);
}
