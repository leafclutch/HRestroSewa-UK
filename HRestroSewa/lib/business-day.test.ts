import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROOM_DOUBLE_HOUR,
  DEFAULT_ROOM_NEW_DAY_HOUR,
  normalizeRoomHour,
  normalizeShiftHours,
  resolveRoomDayRule,
  roomNightBoundary,
  roomNights,
  type RoomDayRule,
  businessDate,
  businessDayBounds,
  businessDayRule,
  businessPeriodBounds,
  businessToday,
  earlyCloseWindow,
} from "./business-day.ts";

// Every case below is written in LONDON wall-clock time, because that is the only
// clock the rule is stated in — "6 AM" and "noon" mean 6 AM and noon in London, on
// a server that is almost certainly running UTC. `npt` converts, so the tests read
// as a receptionist would state them and still pin an exact absolute instant.
//
// The BST windows are written out by hand rather than asked of Intl, so these
// tests check the implementation against an independent statement of the rule:
// BST = UTC+1 from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last
// Sunday of October. Valid for any wall time not inside a switch hour itself —
// the clock-change tests at the bottom spell their instants out in UTC.
const BST: Record<number, [string, string]> = {
  2026: ["2026-03-29T01:00:00Z", "2026-10-25T01:00:00Z"],
  2027: ["2027-03-28T01:00:00Z", "2027-10-31T01:00:00Z"],
};
const npt = (day: string, hh: number, mm = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const [from, to] = BST[y].map(Date.parse);
  const bst = wall - 3_600_000 >= from && wall - 3_600_000 < to;
  return new Date(bst ? wall - 3_600_000 : wall);
};
const utc = (iso: string) => new Date(iso);

/** The default rule: a room day starts at 6 AM, the price steps up at noon. */
const RULE: RoomDayRule = { newDayHour: 6, doubleHour: 12, shiftHours: 0 };

// ── The two cases the feature was specified from ─────────────────────────────
// These are the user's own worked examples, kept verbatim. If either ever fails,
// the feature is wrong no matter what the rest of the file says.

test("arriving in the evening: the price doubles at TOMORROW noon", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-15", 12).toISOString()
  );
  assert.equal(roomNights(checkIn, npt("2026-08-15", 10), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 13), RULE), 2);
});

test("arriving at 3 AM is LAST night's guest: the price doubles at TODAY noon", () => {
  const checkIn = npt("2026-08-14", 3);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-14", 12).toISOString()
  );
  assert.equal(roomNights(checkIn, npt("2026-08-14", 11), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-14", 13), RULE), 2);
});

// ── The boundary itself ──────────────────────────────────────────────────────

test("two minutes either side of the new-day hour is a whole night apart", () => {
  // The entire point of the setting, and its sharpest edge: 05:59 belongs to the
  // previous room-day and so is already one night in by the time 06:01 arrives.
  const early = npt("2026-08-14", 5, 59);
  const late = npt("2026-08-14", 6, 1);
  const leaving = npt("2026-08-15", 10);

  assert.equal(roomNights(early, leaving, RULE), 2);
  assert.equal(roomNights(late, leaving, RULE), 1);
});

test("arriving exactly ON the new-day hour counts as the new day", () => {
  const checkIn = npt("2026-08-14", 6);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-15", 12).toISOString()
  );
});

test("leaving exactly ON the boundary is the night it closes, not the next one", () => {
  // Matches the old 24-hour rule's "24h is one night, not two". A guest who walks
  // out as the clock strikes noon has not started another night.
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 12), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 12, 1), RULE), 2);
});

test("a multi-night stay counts every boundary it crosses", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-16", 10), RULE), 2);
  assert.equal(roomNights(checkIn, npt("2026-08-17", 10), RULE), 3);
  assert.equal(roomNights(checkIn, npt("2026-08-24", 10), RULE), 10);
});

test("a stay always costs at least one night", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-14", 21), RULE), 1);
  // Nonsense inputs must not produce 0 or a negative charge.
  assert.equal(roomNights(checkIn, checkIn, RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-13", 10), RULE), 1);
  assert.equal(roomNights(checkIn, "not a date", RULE), 1);
});

// ── Date arithmetic across the awkward rollovers ─────────────────────────────
// The underlying maths is done on date STRINGS, so month and year ends are where
// a naive implementation breaks.

test("the boundary crosses a month end", () => {
  assert.equal(
    roomNightBoundary(npt("2026-08-31", 20), 1, RULE).toISOString(),
    npt("2026-09-01", 12).toISOString()
  );
});

test("the boundary crosses a year end", () => {
  assert.equal(
    roomNightBoundary(npt("2026-12-31", 20), 1, RULE).toISOString(),
    npt("2027-01-01", 12).toISOString()
  );
});

test("a 3 AM arrival on the 1st reaches back into the previous month", () => {
  // room-day is 31 July, so the first boundary is 1 August noon — the same day
  // they arrived, which is the surprising-but-correct half of the rule.
  assert.equal(
    roomNightBoundary(npt("2026-08-01", 3), 1, RULE).toISOString(),
    npt("2026-08-01", 12).toISOString()
  );
});

// ── The per-stay shift ───────────────────────────────────────────────────────

test("a shift pushes every boundary of the stay later", () => {
  const shifted: RoomDayRule = { ...RULE, shiftHours: 3 };
  const checkIn = npt("2026-08-14", 20);

  assert.equal(
    roomNightBoundary(checkIn, 1, shifted).toISOString(),
    npt("2026-08-15", 15).toISOString()
  );
  assert.equal(
    roomNightBoundary(checkIn, 2, shifted).toISOString(),
    npt("2026-08-16", 15).toISOString()
  );
});

test("a shift can save the guest a night", () => {
  const checkIn = npt("2026-08-14", 20);
  const leaving = npt("2026-08-15", 14); // 2 PM — past noon, before 3 PM

  assert.equal(roomNights(checkIn, leaving, RULE), 2);
  assert.equal(roomNights(checkIn, leaving, { ...RULE, shiftHours: 3 }), 1);
});

test("a shift is capped at 12 hours so it can never gift a whole night", () => {
  assert.equal(normalizeShiftHours(24), 12);
  assert.equal(normalizeShiftHours(13), 12);
  assert.equal(normalizeShiftHours(12), 12);
  assert.equal(normalizeShiftHours(-1), 0);
  assert.equal(normalizeShiftHours(1.5), 0);
  assert.equal(normalizeShiftHours(null), 0);
  assert.equal(normalizeShiftHours(undefined), 0);
  assert.equal(normalizeShiftHours("3"), 3);
});

// ── Degrading safely ─────────────────────────────────────────────────────────

test("a nonsense hour falls back to the default, never to midnight", () => {
  // Midnight would be the worst possible silent failure: every boundary moves
  // and nobody sees an error.
  for (const bad of [null, undefined, "noon", -1, 24, 99, 6.5, NaN, {}]) {
    assert.equal(normalizeRoomHour(bad, DEFAULT_ROOM_DOUBLE_HOUR), 12);
    assert.equal(normalizeRoomHour(bad, DEFAULT_ROOM_NEW_DAY_HOUR), 6);
  }
  assert.equal(normalizeRoomHour(0, 12), 0); // a real 0 is still a real hour
  assert.equal(normalizeRoomHour("14", 12), 14);
});

test("the check-in snapshot beats the live setting", () => {
  // The guarantee that stops an admin re-pricing a settled bill next March.
  const rule = resolveRoomDayRule({
    settings: { room_new_day_hour: 4, room_price_double_hour: 10 },
    stayNewDayHour: 6,
    stayDoubleHour: 12,
  });
  assert.deepEqual(rule, { newDayHour: 6, doubleHour: 12, shiftHours: 0 });
});

test("a stay with no snapshot follows the live setting", () => {
  // Which is what lets stays already in progress adopt the rule when it ships.
  const rule = resolveRoomDayRule({
    settings: { room_new_day_hour: 4, room_price_double_hour: 10 },
    stayNewDayHour: null,
    stayDoubleHour: null,
    shiftHours: 2,
  });
  assert.deepEqual(rule, { newDayHour: 4, doubleHour: 10, shiftHours: 2 });
});

test("no settings at all yields 6 AM / noon", () => {
  assert.deepEqual(resolveRoomDayRule({ settings: null }), {
    newDayHour: 6,
    doubleHour: 12,
    shiftHours: 0,
  });
  assert.deepEqual(resolveRoomDayRule({}), {
    newDayHour: 6,
    doubleHour: 12,
    shiftHours: 0,
  });
});

test("the two hours are independent — a hotel can run 4 AM / 11 AM", () => {
  const rule: RoomDayRule = { newDayHour: 4, doubleHour: 11, shiftHours: 0 };
  assert.equal(
    roomNightBoundary(npt("2026-08-14", 3), 1, rule).toISOString(),
    npt("2026-08-14", 11).toISOString()
  );
  assert.equal(
    roomNightBoundary(npt("2026-08-14", 5), 1, rule).toISOString(),
    npt("2026-08-15", 11).toISOString()
  );
});

// ── Closing hour on either side of midnight ──────────────────────────────────

test("closing at 2 AM keeps after-midnight sales on the night before", () => {
  const rule = businessDayRule({ business_closing_hour: 2 });
  assert.equal(businessDate(npt("2026-10-11", 1, 30), rule), "2026-10-10");
  assert.equal(businessDate(npt("2026-10-11", 2), rule), "2026-10-11");
});

test("closing at 10 PM sends later sales to tomorrow", () => {
  const rule = businessDayRule({ business_closing_hour: 22 });
  assert.equal(businessDate(npt("2026-10-11", 21, 59), rule), "2026-10-11");
  assert.equal(businessDate(npt("2026-10-11", 22), rule), "2026-10-12");
  assert.equal(businessDate(npt("2026-10-11", 9), rule), "2026-10-11");
  const { from, to } = businessDayBounds("2026-10-11", rule);
  assert.equal(from.toISOString(), npt("2026-10-10", 22).toISOString());
  assert.equal(to.toISOString(), npt("2026-10-11", 22).toISOString());
});

test("closing at 9 PM: This Month after 9 PM on the last day is already next month", () => {
  const rule = businessDayRule({ business_closing_hour: 21 });
  const { from } = businessPeriodBounds("month", rule, null, null, npt("2026-10-31", 21, 30));
  assert.equal(from.toISOString(), npt("2026-10-31", 21).toISOString());
});

// ── Close today's business ────────────────────────────────────────────────────

test("an early close ends that day at the instant it was pressed", () => {
  const closedAt = npt("2026-10-11", 20, 5);
  const rule = businessDayRule({
    business_closing_hour: 22,
    business_early_closes: { "2026-10-11": closedAt.toISOString() },
  });
  assert.equal(businessDate(npt("2026-10-11", 20), rule), "2026-10-11");
  assert.equal(businessDate(npt("2026-10-11", 20, 5), rule), "2026-10-12");
  assert.equal(businessToday(rule, npt("2026-10-11", 20, 30)), "2026-10-12");

  const closed = businessDayBounds("2026-10-11", rule);
  assert.equal(closed.to.toISOString(), closedAt.toISOString());
  const next = businessDayBounds("2026-10-12", rule);
  assert.equal(next.from.toISOString(), closedAt.toISOString());
  // …and the day after it is back on the normal closing hour.
  assert.equal(next.to.toISOString(), npt("2026-10-12", 22).toISOString());
});

test("an early close works with a past-midnight closing hour too", () => {
  const closedAt = npt("2026-10-11", 23);
  const rule = businessDayRule({
    business_closing_hour: 3,
    business_early_closes: { "2026-10-11": closedAt.toISOString() },
  });
  assert.equal(businessDate(npt("2026-10-12", 1), rule), "2026-10-12");
  assert.equal(businessDate(npt("2026-10-12", 4), rule), "2026-10-12");
  assert.equal(businessDayBounds("2026-10-12", rule).to.toISOString(), npt("2026-10-13", 3).toISOString());
});

test("junk in the early-close map is ignored", () => {
  const rule = businessDayRule({
    business_closing_hour: 0,
    business_early_closes: { "2026-10-11": "nope", bad: "2026-10-11T00:00:00Z", x: 5 },
  });
  assert.deepEqual(rule.earlyCloses, {});
});

test("an early close stranded by a later closing-hour change is ignored", () => {
  // Closed at 8:05 PM under a midnight closing hour, then the hour moved to 6 PM:
  // 8:05 PM is now past the day's normal end, so the day just ends at 6 PM.
  const rule = businessDayRule({
    business_closing_hour: 18,
    business_early_closes: { "2026-10-11": npt("2026-10-11", 20, 5).toISOString() },
  });
  const bill = npt("2026-10-11", 19);
  const day = businessDate(bill, rule);
  const { from, to } = businessDayBounds(day, rule);
  assert.equal(day, "2026-10-12");
  assert.ok(bill >= from && bill < to, "the bill sits inside its own day's bounds");
});

// ── When "Close today's business" is allowed ─────────────────────────────────

test("5 PM closing: pressing Close at 6 PM is refused — the new day is an hour old", () => {
  const rule = businessDayRule({ business_closing_hour: 17 });
  const w = earlyCloseWindow(rule, npt("2026-10-11", 18));
  assert.equal(w.today, "2026-10-12"); // after 5 PM it is already tomorrow's day
  assert.equal(w.canClose, false);
  // Closable once it has been open six hours: 11 PM.
  assert.equal(w.closableFrom.toISOString(), npt("2026-10-11", 23).toISOString());
});

test("10 PM closing: closing early at 8 PM is allowed", () => {
  const rule = businessDayRule({ business_closing_hour: 22 });
  const w = earlyCloseWindow(rule, npt("2026-10-11", 20));
  assert.equal(w.today, "2026-10-11");
  assert.equal(w.canClose, true);
});

test("2 AM closing, closed at 10 PM: no second close until the new day is six hours old", () => {
  const rule = businessDayRule({
    business_closing_hour: 2,
    business_early_closes: { "2026-10-11": npt("2026-10-11", 22).toISOString() },
  });
  const soon = earlyCloseWindow(rule, npt("2026-10-11", 22, 5));
  assert.equal(soon.today, "2026-10-12");
  assert.equal(soon.canClose, false);
  assert.equal(soon.canReopen, true);
  // 4 AM: six hours in, and past the normal 2 AM start.
  const later = earlyCloseWindow(rule, npt("2026-10-12", 4));
  assert.equal(later.canClose, true);
  assert.equal(later.canReopen, false); // Saturday's normal end (2 AM) has passed
});

// ── Clock changes (Europe/London) ────────────────────────────────────────────
// 2026: clocks go FORWARD at 01:00 UTC on 29 March (GMT → BST) and BACK at
// 01:00 UTC on 25 October (BST → GMT). Instants here are written in UTC because
// the wall clock is exactly what is ambiguous around a change.

test("the spring-forward business day is 23 hours long", () => {
  const rule = businessDayRule({ business_closing_hour: 0 });
  const { from, to } = businessDayBounds("2026-03-29", rule);
  assert.equal(from.toISOString(), "2026-03-29T00:00:00.000Z"); // midnight GMT
  assert.equal(to.toISOString(), "2026-03-29T23:00:00.000Z"); // midnight BST
  // 23:30 UTC is already 00:30 BST on the 30th.
  assert.equal(businessDate(utc("2026-03-29T23:30:00Z"), rule), "2026-03-30");
  assert.equal(businessDate(utc("2026-03-29T22:59:00Z"), rule), "2026-03-29");
});

test("the fall-back business day is 25 hours long", () => {
  const rule = businessDayRule({ business_closing_hour: 0 });
  const { from, to } = businessDayBounds("2026-10-25", rule);
  assert.equal(from.toISOString(), "2026-10-24T23:00:00.000Z"); // midnight BST
  assert.equal(to.toISOString(), "2026-10-26T00:00:00.000Z"); // midnight GMT
  assert.equal(businessDate(utc("2026-10-25T23:30:00Z"), rule), "2026-10-25");
});

test("closing at 2 AM on the fall-back night: the repeated hour stays on Saturday", () => {
  // Day 24 Oct runs 02:00 BST (01:00 UTC on the 24th) to 02:00 GMT (02:00 UTC on
  // the 25th). Both 01:30s that night — BST then GMT — are Saturday's trade.
  const rule = businessDayRule({ business_closing_hour: 2 });
  assert.equal(businessDate(utc("2026-10-25T00:30:00Z"), rule), "2026-10-24"); // 01:30 BST
  assert.equal(businessDate(utc("2026-10-25T01:30:00Z"), rule), "2026-10-24"); // 01:30 GMT
  assert.equal(businessDate(utc("2026-10-25T02:00:00Z"), rule), "2026-10-25"); // 02:00 GMT
  const { from, to } = businessDayBounds("2026-10-24", rule);
  assert.equal(from.toISOString(), "2026-10-24T01:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-25T02:00:00.000Z");
});

test("closing at 2 AM on the spring-forward night: the day ends when the clocks jump past 2", () => {
  // 02:00 BST on the 29th is 01:00 UTC — the clocks go from 00:59 GMT to 02:00 BST.
  const rule = businessDayRule({ business_closing_hour: 2 });
  assert.equal(businessDayBounds("2026-03-28", rule).to.toISOString(), "2026-03-29T01:00:00.000Z");
  assert.equal(businessDate(utc("2026-03-29T00:59:00Z"), rule), "2026-03-28");
  assert.equal(businessDate(utc("2026-03-29T01:00:00Z"), rule), "2026-03-29");
});

test("every business date and its bounds agree across both 2026 clock changes", () => {
  // Sweep each closing hour through the switch weekends in 20-minute steps: the
  // day businessDate names must always contain the instant.
  for (const hour of [0, 1, 2, 3, 6, 12, 18, 22, 23]) {
    const rule = businessDayRule({ business_closing_hour: hour });
    for (const start of ["2026-03-27T00:00:00Z", "2026-10-23T00:00:00Z"]) {
      for (let t = Date.parse(start); t < Date.parse(start) + 4 * 86_400_000; t += 20 * 60_000) {
        const at = new Date(t);
        const { from, to } = businessDayBounds(businessDate(at, rule), rule);
        assert.ok(at >= from && at < to, `hour ${hour}, ${at.toISOString()}`);
      }
    }
  }
});

test("a room night spanning spring-forward is 23h — and is still charged", () => {
  // In 27 Mar 8 PM GMT. Night 1 ends 28 Mar noon GMT (12:00Z); night 2 ends
  // 29 Mar noon BST (11:00Z), only 23h later. Leaving 12:30 BST is a 3rd night.
  const checkIn = utc("2026-03-27T20:00:00Z");
  assert.equal(roomNightBoundary(checkIn, 1, RULE).toISOString(), "2026-03-28T12:00:00.000Z");
  assert.equal(roomNightBoundary(checkIn, 2, RULE).toISOString(), "2026-03-29T11:00:00.000Z");
  assert.equal(roomNights(checkIn, utc("2026-03-29T10:59:00Z"), RULE), 2);
  assert.equal(roomNights(checkIn, utc("2026-03-29T11:30:00Z"), RULE), 3);
});

test("a room night spanning fall-back is 25h — and is not over-charged", () => {
  // In 23 Oct 8 PM BST. Night 2 ends 25 Oct noon GMT (12:00Z), 25h after
  // night 1's end. Leaving 11:30 GMT is still inside night 2.
  const checkIn = utc("2026-10-23T19:00:00Z");
  assert.equal(roomNightBoundary(checkIn, 1, RULE).toISOString(), "2026-10-24T11:00:00.000Z");
  assert.equal(roomNightBoundary(checkIn, 2, RULE).toISOString(), "2026-10-25T12:00:00.000Z");
  assert.equal(roomNights(checkIn, utc("2026-10-25T11:30:00Z"), RULE), 2);
  assert.equal(roomNights(checkIn, utc("2026-10-25T12:01:00Z"), RULE), 3);
});

test("a long stay counts nights by the calendar, not by 24-hour blocks", () => {
  // Across a whole year (two clock changes), checking out at 11 AM every day
  // must charge exactly one more night per day.
  const checkIn = npt("2026-01-10", 20);
  let day = "2026-01-11";
  for (let n = 1; n <= 365; n++) {
    assert.equal(roomNights(checkIn, npt(day, 11), RULE), n, day);
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    day = next.toISOString().slice(0, 10);
  }
});

test("a per-stay shift stays on the wall clock across a clock change", () => {
  // "Keep the room until 3 PM" on the spring-forward day means 3 PM BST.
  const checkIn = utc("2026-03-28T20:00:00Z");
  const shifted: RoomDayRule = { ...RULE, shiftHours: 3 };
  assert.equal(roomNightBoundary(checkIn, 1, shifted).toISOString(), "2026-03-29T14:00:00.000Z");
});
