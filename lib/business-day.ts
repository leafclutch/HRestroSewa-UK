// THE definition of a business day. Every report, filter and day picker in the
// app resolves its dates through this file and nowhere else.
//
// WHY IT EXISTS: a restaurant that serves until 2am treats those sales as part
// of the previous night's trading. The books said otherwise — a 00:45 bill
// landed on the next calendar day, splitting one evening's takings across two
// reports. So the boundary is configurable per restaurant
// (`restaurants.settings.business_closing_hour`, whole hours 0–23, default 0 =
// midnight = the old behaviour).
//
// A closing hour can sit on EITHER side of midnight, and which side decides which
// calendar date the 24-hour window is named after — the one holding most of it:
//
//   before noon (0–11)  late close: the small hours belong to the night before
//       business day D  =  [ D h:00 , D+1 h:00 )            e.g. 2 AM
//   noon or later (12–23)  early close: after closing is already tomorrow
//       business day D  =  [ D-1 h:00 , D h:00 )            e.g. 10 PM
//
// Both are the same formula with a signed OFFSET from midnight (h, or h − 24):
//
//   business day D  =  [ D offset , D+1 offset )
//
// The day-maths functions below take a `DayRule`. A plain number is a raw offset
// (the room-night rules use that form, where 12 means noon of that date, not the
// day before); a restaurant's closing hour reaches them as a `BusinessDayRule`
// built by `businessDayRule(settings)`, which does the flip and also carries…
//
// ── EARLY CLOSES ──────────────────────────────────────────────────────────────
// "Close today's business" ends the current day at the instant it is pressed.
// It is stored per business date (`settings.business_early_closes`, date → ISO
// instant) and only moves THAT day's end — and so the next day's start. The day
// after reverts to the normal closing hour without anyone touching anything.
// It is kept forever on purpose: forgetting it would quietly pull the evening's
// later bills back into the day that was closed.
//
// ── TIMEZONE: PINNED TO THE RESTAURANT'S ZONE, NOT THE SERVER ────────────────
// This used to compute in the SERVER's local timezone, which was fine on a dev
// machine in the restaurant's own zone but WRONG in production on a UTC server:
// "today" was the server's calendar day, so the previous evening's late sales
// landed in today's total — the "yesterday shows in my today's sales" bug.
//
// So the zone is pinned (Europe/London — see TIMEZONE below) and independent of
// where the server runs. All arithmetic below is done on London wall-clock date
// STRINGS (calendar maths, tz-free) and only converted to an absolute instant at
// the very end, through the zone's offset at that wall time.
//
// THE RULE THAT IS EASY TO GET WRONG: every period is derived from
// `businessDate(now, h)` — the business day we are *currently inside* — never
// from `now`'s calendar date. At 01:00 on 1 August with h=3 we are still inside
// business day 31 July, so "This Month" must mean JULY.
//
// The upper bound is always EXCLUSIVE, which is what makes the carry-forward
// exact: one period's closing and the next period's opening are the same instant.
//
// Client components must not compute business days themselves — the browser's
// clock is yet another clock. Format timestamps there; bucket them here.

export const DEFAULT_CLOSING_HOUR = 0;

// ── TIMEZONE: EUROPE/LONDON (this is the UK build) ───────────────────────────
// This file was first written for Nepal, a fixed UTC+05:45. London is NOT fixed:
// GMT (UTC+0) in winter, BST (UTC+1) from the last Sunday of March to the last
// Sunday of October, both switches at 01:00 UTC. So the offset is looked up per
// instant from the zone database rather than held in a constant, and two things
// stop being true that the Nepal code could rely on:
//
//   - a business day is not always 24h long — 23h in spring, 25h in autumn;
//   - an absolute shift of N hours is not always N wall-clock hours.
//
// Everything below therefore converts at the wall clock (`zoneInstant`,
// `zoneDateStr`) and never adds fixed day-lengths to cross a boundary.
// Nonexistent spring times (01:xx on the switch day) resolve to just after the
// jump; repeated autumn times resolve to the GMT (later) occurrence.
//
// `APP_TIME_ZONE` in format-time.ts names the same zone for display.
const TIME_ZONE = "Europe/London";

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const HOUR_MS = 60 * 60 * 1000;

// London's offset only ever changes on a whole UTC hour, so one lookup per UTC
// hour is exact. Report and sales code calls this per row, hence the memo.
const offsetMemo = new Map<number, number>();

/** The zone's UTC offset in ms at an absolute instant (BST → 3_600_000). */
function zoneOffsetMs(t: number): number {
  const key = Math.floor(t / HOUR_MS);
  const hit = offsetMemo.get(key);
  if (hit !== undefined) return hit;
  const p: Record<string, number> = {};
  for (const { type, value } of zoneParts.formatToParts(new Date(key * HOUR_MS))) {
    if (type !== "literal") p[type] = Number(value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const off = asUtc - key * HOUR_MS;
  if (offsetMemo.size > 10_000) offsetMemo.clear();
  offsetMemo.set(key, off);
  return off;
}

/**
 * Coerce whatever is sitting in the settings jsonb into a usable hour.
 *
 * Settings are free-form JSON, so this may be a number, a string, absent, or
 * nonsense. Anything that isn't a whole hour in 0–23 collapses to the default,
 * which is midnight — i.e. a bad value degrades to the behaviour the app had
 * before this feature, never to a random boundary.
 */
export function normalizeClosingHour(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_CLOSING_HOUR;
  return n;
}

/**
 * A restaurant's business-day boundary, resolved. `offset` is signed hours from
 * local midnight (−12…11); `earlyCloses` maps a business date to the instant it
 * was closed early.
 */
export type BusinessDayRule = {
  hour: number;
  offset: number;
  earlyCloses: Readonly<Record<string, string>>;
};

/** A `BusinessDayRule`, or a bare offset in hours (no early closes). */
export type DayRule = number | BusinessDayRule;

/** Closing hour → signed offset from midnight. 22 (10 PM) → −2; 3 → 3. */
export function closingOffset(hour: number): number {
  return hour >= 12 ? hour - 24 : hour;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce `settings.business_early_closes` into date → ISO, dropping junk. */
export function normalizeEarlyCloses(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [day, at] of Object.entries(v as Record<string, unknown>)) {
    if (DATE_RE.test(day) && typeof at === "string" && Number.isFinite(Date.parse(at))) {
      out[day] = at;
    }
  }
  return out;
}

/** The restaurant's rule, from its `settings` jsonb. */
export function businessDayRule(
  settings: { business_closing_hour?: unknown; business_early_closes?: unknown } | null | undefined
): BusinessDayRule {
  const hour = normalizeClosingHour(settings?.business_closing_hour);
  return {
    hour,
    offset: closingOffset(hour),
    earlyCloses: normalizeEarlyCloses(settings?.business_early_closes),
  };
}

const offsetOf = (rule: DayRule) => (typeof rule === "number" ? rule : rule.offset);

/**
 * The instant `day` was closed early, if it was — and only while that instant
 * still lies inside the day's normal window. An early close is recorded against
 * the closing hour in force at the time; if the hour is changed later the stored
 * instant can fall outside the day it names (past its new end, or before its new
 * start). Honouring it then would make `businessDate` and the day bounds disagree
 * about the same bill, so it is ignored and the day runs to its normal hour.
 */
function earlyCloseOf(rule: DayRule, day: string): Date | null {
  if (typeof rule === "number") return null;
  const raw = rule.earlyCloses[day];
  if (!raw) return null;
  const at = new Date(raw);
  const opens = zoneInstant(day, rule.offset);
  const closes = zoneInstant(addDaysStr(day, 1), rule.offset);
  return at >= opens && at < closes ? at : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The London wall-clock date (YYYY-MM-DD) of an absolute instant. */
function zoneDateStr(at: Date): string {
  // Shift into local time, then read the UTC parts — those ARE the local parts.
  const d = new Date(at.getTime() + zoneOffsetMs(at.getTime()));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The absolute instant of London-local `day hour:00:00`. `hour` may be negative
 * (−2 = 22:00 the day before) — Date.UTC normalises it on the wall clock, which
 * is the point: the offset is then resolved for THAT wall time, not for `day`.
 */
function zoneInstant(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour, 0, 0, 0);
  // Guess with the offset at the wall time read as UTC, then re-check at the
  // guessed instant; they differ only within an hour of a clock change.
  const first = wall - zoneOffsetMs(wall);
  const second = wall - zoneOffsetMs(first);
  return new Date(second);
}

/** Calendar add on a date STRING — pure UTC maths, so it is timezone-free. */
function addDaysStr(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const firstOfMonthStr = (day: string) => `${day.slice(0, 7)}-01`;
const firstOfYearStr = (day: string) => `${day.slice(0, 4)}-01-01`;

/**
 * Calendar add/subtract on a YYYY-MM-DD business-day STRING (pure UTC maths, so
 * timezone-free). `addBusinessDays(businessToday(h), -1)` is the previous, fully
 * closed business day — what the daily-summary job reports on.
 */
export function addBusinessDays(day: string, n: number): string {
  return addDaysStr(day, n);
}

/**
 * The instant business day `day` begins: local midnight of that date plus the
 * rule's offset — or, when the day before was closed early, that instant.
 * Accepts a YYYY-MM-DD string, or a Date (read as its London day).
 */
export function businessDayStart(day: string | Date, rule: DayRule): Date {
  const s = typeof day === "string" ? day : zoneDateStr(day);
  return earlyCloseOf(rule, addDaysStr(s, -1)) ?? zoneInstant(s, offsetOf(rule));
}

/** Where `day` would begin on the normal closing hour, ignoring early closes. */
export function businessDayScheduledStart(day: string, rule: DayRule): Date {
  return zoneInstant(day, offsetOf(rule));
}

/**
 * Which business day does this instant belong to?
 *
 * Shifting back by the offset is the whole trick: with 3 AM, a 02:50 stamp moves
 * to 23:50 the previous day and reads off that London date; with 10 PM (−2), a
 * 22:30 stamp moves to 00:30 the next day. Then an early close of that day, if
 * the stamp is past it, hands the stamp to the following day.
 *
 * Within an hour of a clock change the shift is an hour out (it is absolute, the
 * boundary is wall-clock), so the guess is then checked against the day's
 * scheduled bounds — the same `zoneInstant` they are built from — which keeps
 * `businessDate` and `businessDayBounds` from ever disagreeing about a bill.
 */
export function businessDate(at: Date, rule: DayRule): string {
  const offset = offsetOf(rule);
  let d = zoneDateStr(new Date(at.getTime() - offset * HOUR_MS));
  if (at < zoneInstant(d, offset)) d = addDaysStr(d, -1);
  else if (at >= zoneInstant(addDaysStr(d, 1), offset)) d = addDaysStr(d, 1);
  // Bounded: a day can only be closed early once it has started, so at most a
  // couple of consecutive early closes can ever cover one instant.
  for (let i = 0; i < 3; i++) {
    const closed = earlyCloseOf(rule, d);
    if (!closed || at < closed) break;
    d = addDaysStr(d, 1);
  }
  return d;
}

/**
 * The business day we are currently inside, as YYYY-MM-DD.
 *
 * `now` is injectable ONLY so the boundary rules can be tested at instants a
 * test can't otherwise reach — 01:00 on the 1st of a month, or exactly h:00:00.
 * Production callers never pass it.
 */
export function businessToday(rule: DayRule, now: Date = new Date()): string {
  return businessDate(now, rule);
}

/** Bounds for ONE business day (the London date, or today's). */
export function businessDayBounds(
  day: string | null | undefined,
  rule: DayRule
): { from: Date; to: Date } {
  const d = day ?? businessToday(rule);
  return { from: businessDayStart(d, rule), to: businessDayStart(addDaysStr(d, 1), rule) };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ROOM NIGHT BOUNDARY
//
// A hotel night does not run for 24 hours from whenever the guest walked in — it
// ends at CHECKOUT TIME, the same wall-clock hour for everyone in the building.
// Two guests in identical rooms who arrived three hours apart used to cross into
// night two three hours apart, which is not how any front desk works.
//
// Two hours define the rule:
//
//   newDayHour  which DAY an arrival belongs to. Arriving 8 PM on the 14th is
//               the 14th; arriving 3 AM on the 14th is still the 13th's guest —
//               they came in "last night". Exactly the trick businessDate() uses
//               for late trading, applied to arrivals instead of bills.
//   doubleHour  the hour on each following day at which the next night starts.
//
//   night n of a stay ends at   doubleHour on (arrival's room-day + n)
//
// Worked, with newDay 6 AM and double 12 PM:
//   check in 14th 8:00 PM → room-day 14th → night 1 ends 15th 12 PM (tomorrow)
//   check in 14th 3:00 AM → room-day 13th → night 1 ends 14th 12 PM (today)
//
// Both of those are the same single line of arithmetic, which is the reason this
// shape was chosen over special-casing "early morning arrivals".
//
// The whole rule lives HERE and not in room-billing.ts because it is day maths,
// and day maths lives in one file (see the header). room-billing.ts owns money.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROOM_NEW_DAY_HOUR = 6;
export const DEFAULT_ROOM_DOUBLE_HOUR = 12;

/** The most hours a stay's boundary may be pushed back. See `normalizeShiftHours`. */
export const MAX_ROOM_SHIFT_HOURS = 12;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RoomDayRule = {
  /** Which day an arrival belongs to (0–23). */
  newDayHour: number;
  /** The hour each following night begins (0–23). */
  doubleHour: number;
  /** Per-stay courtesy: push every boundary this many hours later (0–12). */
  shiftHours: number;
};

/**
 * Coerce a settings/column value into a usable hour, falling back to `fallback`.
 *
 * The twin of `normalizeClosingHour`, and for the same reason: settings are
 * free-form JSON and these two also arrive as nullable smallint columns, so a
 * bad value must land on the documented default rather than on hour 0 — which
 * for `doubleHour` would silently move every night boundary to midnight.
 */
export function normalizeRoomHour(v: unknown, fallback: number): number {
  // Reject the empty-ish values BEFORE Number() sees them. `Number(null)`,
  // `Number("")` and `Number(false)` are all 0 — a perfectly valid hour — so a
  // null column or a blank form field would otherwise resolve to MIDNIGHT and
  // move every boundary with nothing on screen to say so. This is the one
  // degradation that must never happen quietly.
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

/**
 * Clamp a per-stay shift to 0–12 hours.
 *
 * Capped at 12 on purpose: a shift of 24 or more would step over a whole
 * boundary, so "give them a few more hours" would silently become "give them a
 * free night". The DB carries the same CHECK, this is the front line.
 */
export function normalizeShiftHours(v: unknown): number {
  // Same empty-ish guard as normalizeRoomHour. Here the fallback happens to BE
  // 0, so it changes no answer today — but the two must not drift apart, and a
  // reader should not have to work out that the bug is harmless in this one.
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, MAX_ROOM_SHIFT_HOURS);
}

/**
 * Resolve the rule for one stay.
 *
 * `stayNewDayHour`/`stayDoubleHour` are the SNAPSHOT taken at check-in. They win
 * when present, so an admin who changes the hours next March cannot re-price a
 * bill that was settled today — the same guarantee `room_stays.room_rate` gives
 * against a room-type price rise. Null (a stay that predates the feature) falls
 * back to the restaurant's live setting, which is what lets stays already in
 * progress adopt the new rule the moment it ships.
 */
export function resolveRoomDayRule(args: {
  settings?: { room_new_day_hour?: unknown; room_price_double_hour?: unknown } | null;
  stayNewDayHour?: unknown;
  stayDoubleHour?: unknown;
  shiftHours?: unknown;
}): RoomDayRule {
  const liveNewDay = normalizeRoomHour(
    args.settings?.room_new_day_hour,
    DEFAULT_ROOM_NEW_DAY_HOUR
  );
  const liveDouble = normalizeRoomHour(
    args.settings?.room_price_double_hour,
    DEFAULT_ROOM_DOUBLE_HOUR
  );
  return {
    newDayHour:
      args.stayNewDayHour === null || args.stayNewDayHour === undefined
        ? liveNewDay
        : normalizeRoomHour(args.stayNewDayHour, liveNewDay),
    doubleHour:
      args.stayDoubleHour === null || args.stayDoubleHour === undefined
        ? liveDouble
        : normalizeRoomHour(args.stayDoubleHour, liveDouble),
    shiftHours: normalizeShiftHours(args.shiftHours),
  };
}

/**
 * The instant night `n` of a stay ends — i.e. when the charge steps up to n+1.
 * `n = 1` is the first increment, so this is also "when does the price double".
 */
export function roomNightBoundary(checkIn: Date | string, n: number, rule: RoomDayRule): Date {
  const arrival = new Date(checkIn);
  // Which day did this guest arrive on? Shifting back by newDayHour is the same
  // move businessDate makes: with 6, a 03:00 arrival reads as the previous date.
  const roomDay = businessDate(arrival, rule.newDayHour);
  // The shift is added on the WALL CLOCK (zoneInstant normalises an hour past
  // 23), so "until 3 PM" stays 3 PM even when the night spans a clock change.
  return businessDayStart(addBusinessDays(roomDay, n), rule.doubleHour + rule.shiftHours);
}

/**
 * Chargeable nights under the boundary rule.
 *
 * Always at least 1 — a part-night costs a whole one, because the room was
 * unavailable to anyone else for it. That is unchanged from the 24-hour rule.
 *
 * A checkout landing EXACTLY on a boundary is the earlier night, matching the
 * old rule's "24h is one night, not two": the boundary belongs to the period it
 * closes.
 *
 * Nights are NOT all 24h in London — the one holding a clock change is 23h or
 * 25h — so a plain division can be one night out within an hour of a boundary.
 * It is used as an estimate and then corrected against the real boundaries. The
 * error is at most an hour per clock change and the changes alternate, so the
 * correction is at most one step either way: a stay left open for a year still
 * cannot turn the folio into a spin.
 */
export function roomNights(
  checkIn: Date | string,
  checkOut: Date | string,
  rule: RoomDayRule
): number {
  const to = new Date(checkOut).getTime();
  const first = roomNightBoundary(checkIn, 1, rule).getTime();
  if (!Number.isFinite(to) || !Number.isFinite(first)) return 1;
  const over = to - first;
  if (over <= 0) return 1;
  // n nights cover the stay when it ends at or before boundary n.
  const ends = (n: number) => roomNightBoundary(checkIn, n, rule).getTime();
  let n = 1 + Math.ceil(over / MS_PER_DAY);
  while (n > 1 && to <= ends(n - 1)) n--;
  while (to > ends(n)) n++;
  return n;
}

export type BusinessPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "all"
  | "custom";

/**
 * Resolve a named period to [from, to) business-day bounds.
 *
 * This is the single resolver — Finance, Sales, Stock, Purchases, Credits,
 * Payroll and the dashboard all come through here, so "This Week" cannot mean
 * two different things on two different screens.
 */
export function businessPeriodBounds(
  period: BusinessPeriod,
  rule: DayRule,
  from?: string | null,
  to?: string | null,
  now: Date = new Date()
): { from: Date; to: Date } {
  // Anchor on the business day we're inside — see the header note.
  const today = businessToday(rule, now);
  const S = (dayStr: string) => businessDayStart(dayStr, rule);
  const tomorrow = S(addDaysStr(today, 1));

  switch (period) {
    case "today":
      return { from: S(today), to: tomorrow };
    case "yesterday":
      return { from: S(addDaysStr(today, -1)), to: S(today) };
    // Week/month/year run up to the end of the current business day, so today's
    // trading is included.
    case "week":
      return { from: S(addDaysStr(today, -6)), to: tomorrow };
    case "month":
      return { from: S(firstOfMonthStr(today)), to: tomorrow };
    case "year":
      return { from: S(firstOfYearStr(today)), to: tomorrow };
    case "all":
      return { from: new Date(0), to: tomorrow };
    case "custom": {
      const fromDay = from || today;
      const f = S(fromDay);
      // `to` is a business day the user means to INCLUDE, so push to its end.
      const t = to ? S(addDaysStr(to, 1)) : tomorrow;
      // A `to` before `from` would give an empty or negative window; fall back to
      // the single day `from` names rather than reporting nothing.
      return { from: f, to: t > f ? t : S(addDaysStr(fromDay, 1)) };
    }
  }
}

/**
 * The same resolution as `businessPeriodBounds`, but as YYYY-MM-DD STRINGS
 * rather than instants — for filtering a column that is itself a business-date
 * string (e.g. `report_deliveries.period_key`), not a timestamptz.
 *
 * Deliberately NOT `businessPeriodBounds(...).from.toISOString().slice(0, 10)`:
 * an instant's `toISOString()` reads back in UTC, which can name the WRONG London
 * calendar day (BST is UTC+1 — the exact class of bug this whole file
 * exists to prevent, see the header note). Staying in string space the entire
 * way sidesteps that conversion instead of relying on getting it right twice.
 */
export function businessPeriodDateBounds(
  period: Exclude<BusinessPeriod, "yesterday" | "custom">,
  rule: DayRule,
  now: Date = new Date()
): { from: string | null; to: string | null } {
  const today = businessToday(rule, now);
  const tomorrow = addDaysStr(today, 1);

  switch (period) {
    case "today":
      return { from: today, to: tomorrow };
    case "week":
      return { from: addDaysStr(today, -6), to: tomorrow };
    case "month":
      return { from: firstOfMonthStr(today), to: tomorrow };
    case "year":
      return { from: firstOfYearStr(today), to: tomorrow };
    case "all":
      return { from: null, to: null };
  }
}

/** The instant `day` was closed early, if that close still applies (see `earlyCloseOf`). */
export function businessDayEarlyClose(day: string, rule: DayRule): Date | null {
  return earlyCloseOf(rule, day);
}

/**
 * The youngest a business day may be and still be closed early.
 *
 * With a closing hour of noon or later the evening after closing already belongs
 * to TOMORROW, so "Close today's business" pressed an hour after a 5 PM close
 * would end a day that started an hour ago — leaving a one-hour day and pushing
 * all of the next calendar day's trade onto the day after. No genuine early close
 * happens this soon after a day began; a 10 PM restaurant closing at 8 PM has
 * been open for 22 hours of business day.
 */
export const MIN_HOURS_BEFORE_EARLY_CLOSE = 6;

/** Whether "Close today's business" and "Reopen" are allowed at `now`. */
export function earlyCloseWindow(rule: BusinessDayRule, now: Date = new Date()) {
  const today = businessToday(rule, now);
  const previous = addDaysStr(today, -1);
  const startedAt = businessDayStart(today, rule);
  const scheduledStart = businessDayScheduledStart(today, rule);
  // Two floors, whichever is later: the day must have reached its normal start
  // (so a second tap right after an early close can't end the brand-new day too),
  // and it must have been open long enough to have trade worth closing.
  const minAge = new Date(startedAt.getTime() + MIN_HOURS_BEFORE_EARLY_CLOSE * 60 * 60 * 1000);
  const closableFrom = minAge > scheduledStart ? minAge : scheduledStart;
  const previousClosedEarlyAt = businessDayEarlyClose(previous, rule);
  return {
    today,
    previous,
    startedAt,
    closableFrom,
    canClose: now >= closableFrom,
    previousClosedEarlyAt,
    // Past its normal closing hour the closed day would have ended anyway, so a
    // reopen would change nothing but the history.
    canReopen: previousClosedEarlyAt !== null && now < scheduledStart,
  };
}
