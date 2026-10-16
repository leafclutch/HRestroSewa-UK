// Dates that read the same on the server and in the browser.
//
// `new Date(iso).toLocaleString("en-GB", …)` formats in whatever timezone the
// RUNTIME happens to be in. On a laptop that is the same process family for both
// render passes, so it agrees and nothing looks wrong. In production it does not:
// the server runs UTC and the browser runs the guest's zone, so the same instant
// renders as two different strings —
//
//     SERVER  (UTC)             13 Jul, 06:30 pm
//     BROWSER (Asia/Kathmandu)  14 Jul, 12:15 am     ← a different DAY
//
// which is a hydration mismatch, and worse, prints the wrong date on a bill.
//
// Pinning the zone makes both passes agree and makes them agree on the RIGHT
// answer — the wall-clock time at the restaurant, which is the only time a
// receipt or a check-in stamp ever means.
//
// One constant, so a restaurant in another zone is a one-line change (or a column
// on `restaurants`, when that day comes) rather than a hunt through every file.
// UK build: Europe/London (GMT in winter, BST = UTC+1 in summer). Day maths in
// lib/business-day.ts pins the same zone.
export const APP_TIME_ZONE = "Europe/London";
export const APP_LOCALE = "en-GB";

// 24-hour clock everywhere (UK build): "18:30", never "6:30 pm". Pinned here
// rather than trusted to the locale default, so a future locale change can't
// quietly bring AM/PM back.
const opts = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  ...o,
  hourCycle: "h23",
  timeZone: APP_TIME_ZONE,
});

/**
 * A whole hour (0–23) as a 24-hour clock reading: 0 → "00:00", 22 → "22:00".
 * `named` adds "(midnight)" / "(noon)" for hour pickers, where 00:00 vs 12:00
 * is the one choice people misread.
 */
export function hourLabel(h: number, named = false): string {
  const base = `${String(h).padStart(2, "0")}:00`;
  if (named && h === 0) return `${base} (midnight)`;
  if (named && h === 12) return `${base} (noon)`;
  return base;
}

/** "14 Jul 2026, 00:15" */
export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(APP_LOCALE, opts({ dateStyle: "medium", timeStyle: "short" }));
}

/** "14 Jul, 00:15" — compact, for cards and lists. */
export function formatShort(iso: string | Date): string {
  return new Date(iso).toLocaleString(
    APP_LOCALE,
    opts({ day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  );
}

/** "14 Jul 2026" */
export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, opts({ dateStyle: "medium" }));
}

/** "00:15" */
export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, opts({ hour: "2-digit", minute: "2-digit" }));
}
