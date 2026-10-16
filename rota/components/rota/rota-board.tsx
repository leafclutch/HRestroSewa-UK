"use client";

// COPY of HRestroSewa/components/rota/rota-board.tsx — the Rota app deploys on its own, so it carries its own
// copy. Keep the two in step: a change made in one should be made in the other.

import { useCallback, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Undo2 } from "lucide-react";
import {
  SHIFT_KIND_LABEL,
  addDays,
  dayHeader,
  formatShift,
  hoursLabel,
  rangeLabel,
  shiftPaidHours,
  weekdayIndex,
  type RotaShift,
  type RotaWeek,
} from "@/lib/rota";
import { useRotaApi } from "./rota-api";
import { useCurrency } from "@/components/currency-provider";
import { Modal } from "@/components/ui/modal";
import { ShiftEditor } from "./shift-editor";
import { KIND_COLOR, tint } from "./ui";

// The rota board: staff down the side, Mon–Sun across the top — the same grid as
// the paper rota pinned up in the kitchen. Tap a cell to roster, edit or clear it.
//
// Tablet/desktop: the full week grid. Phone (below md): ONE DAY at a time — a row
// of seven day chips, then a card per person for that day — because a 7-column grid
// at 375px is either unreadable or a sideways-scrolling table, and on a phone the
// question is almost always "who is on today/tomorrow". Both views open the same
// editor and render a cell through the same CellBody, so they cannot disagree.

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What a rota cell says — shared by the grid and the phone list. */
function CellBody({
  s,
  canManage,
  roomy = false,
}: {
  s: RotaShift | null;
  canManage: boolean;
  /** The phone card: bigger time, notes shown, a visible "Add shift". */
  roomy?: boolean;
}) {
  if (!s) {
    if (!canManage) return roomy ? <span className="text-sm">Not rostered</span> : null;
    return roomy ? (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Plus size={14} /> Add shift
      </span>
    ) : (
      <span
        className="flex h-full min-h-[36px] items-center justify-center rounded border border-dashed opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
        style={{ borderColor: "var(--color-hairline-input)" }}
      >
        <Plus size={14} />
      </span>
    );
  }
  const edited = !!s.actual_start;
  return (
    <>
      <span className={`flex items-center gap-1 font-medium whitespace-nowrap ${roomy ? "text-base tabular-nums" : ""}`}>
        {s.kind === "shift" ? formatShift(s) : SHIFT_KIND_LABEL[s.kind]}
        {edited && (
          <span
            title="Actual times differ from the plan"
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--color-warning)" }}
          />
        )}
      </span>
      {s.kind === "shift" && (
        <span className={`block leading-snug ${roomy ? "mt-0.5" : ""}`} style={{ color: "var(--color-ink-mute)" }}>
          {/* Worked time — the break is never in it; a paid break is paid on top. */}
          {`${+shiftPaidHours({ ...s, break_paid: false }).toFixed(2)}h`}
          {s.break_minutes > 0 &&
            `, ${s.break_paid ? "paid" : "unpaid"} break ${s.break_minutes}min`}
        </span>
      )}
      {s.kind === "holiday" && (s.paid_hours ?? 0) > 0 && (
        <span className={`block ${roomy ? "mt-0.5" : ""}`} style={{ color: "var(--color-ink-mute)" }}>
          {hoursLabel(s.paid_hours ?? 0)} paid
        </span>
      )}
      {roomy && s.notes && (
        <span className="block mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
          {s.notes}
        </span>
      )}
    </>
  );
}

/** A cell's fill: a tint of its kind's colour, with a coloured left edge. */
const cellStyle = (s: RotaShift | null): React.CSSProperties =>
  s
    ? {
        background: tint(KIND_COLOR[s.kind], s.kind === "off" ? 8 : 12),
        boxShadow: `inset 3px 0 0 ${KIND_COLOR[s.kind]}`,
        color: "var(--color-ink)",
      }
    : { color: "var(--color-ink-mute)" };

export function RotaBoard({ initial, canManage }: { initial: RotaWeek; canManage: boolean }) {
  const cur = useCurrency();
  const api = useRotaApi();
  const [week, setWeek] = useState(initial);
  const [loading, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ staffId: string; name: string; date: string } | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  // The last copy's new rows, for Undo. Tied to the week it filled: the banner only
  // shows on that week, and a second copy or an undo replaces it.
  const [lastCopy, setLastCopy] = useState<{ weekStart: string; ids: string[] } | null>(null);
  const [undoing, startUndo] = useTransition();
  const [copying, startCopy] = useTransition();
  // The phone view's selected day. Falls back to today (when it is in this week) or
  // Monday, so paging weeks never leaves it pointing at a day the week doesn't hold.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const activeDay =
    pickedDay && week.days.includes(pickedDay)
      ? pickedDay
      : week.days.includes(week.today)
        ? week.today
        : week.days[0];

  const load = useCallback((start: string) => {
    startTransition(async () => {
      try {
        const next = await api.getWeek(start);
        if (next) setWeek(next);
      } catch {
        // keep the last known week on a transient failure
      }
    });
  }, [api]);

  const refresh = useCallback(() => load(week.weekStart), [load, week.weekStart]);
  api.useLiveRefresh(["payroll", "staff"], refresh);

  const go = (by: number) => {
    setCopyMsg(null);
    load(addDays(week.weekStart, by * 7));
  };

  const shiftOf = (staffId: string, date: string) =>
    week.shifts.find((s) => s.staff_id === staffId && s.date === date) ?? null;

  const lastShiftOf = (staffId: string, date: string) =>
    week.shifts
      .filter((s) => s.staff_id === staffId && s.kind === "shift" && s.date < date)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  const weekHours = (staffId: string) =>
    week.shifts
      .filter((s) => s.staff_id === staffId)
      .reduce((a, s) => a + shiftPaidHours(s), 0);

  const dayHours = (date: string) =>
    week.shifts.filter((s) => s.date === date).reduce((a, s) => a + shiftPaidHours(s), 0);

  const totalHours = week.shifts.reduce((a, s) => a + shiftPaidHours(s), 0);
  const totalCost = week.staff.reduce(
    (a, st) => a + weekHours(st.id) * (st.hourly_rate ?? 0),
    0
  );

  const onCopy = () => {
    setCopyMsg(null);
    setLastCopy(null);
    startCopy(async () => {
      const res = await api.copyWeek(week.weekStart);
      if ("error" in res) setCopyMsg(res.error);
      else {
        setCopyMsg(
          res.copied === 0
            ? "Nothing to copy — last week is empty, or every slot here is already filled."
            : `Copied ${res.copied} ${res.copied === 1 ? "entry" : "entries"} from last week.`
        );
        if (res.copied > 0 && res.ids.length > 0) setLastCopy({ weekStart: week.weekStart, ids: res.ids });
        load(week.weekStart);
      }
    });
  };

  const onUndo = () => {
    if (!lastCopy) return;
    const copy = lastCopy;
    startUndo(async () => {
      try {
        const res = await api.undoCopy(copy.ids);
        if ("error" in res) {
          setCopyMsg(res.error);
          return;
        }
        setLastCopy(null);
        const removed = `Undone — removed ${res.removed} copied ${res.removed === 1 ? "entry" : "entries"}.`;
        setCopyMsg(
          res.kept > 0
            ? `${removed} ${res.kept} you edited after copying ${res.kept === 1 ? "was" : "were"} kept.`
            : removed
        );
        load(copy.weekStart);
      } catch {
        setCopyMsg("Could not undo the copy. Please try again.");
      }
    });
  };

  const canUndo = canManage && lastCopy !== null && lastCopy.weekStart === week.weekStart;

  return (
    <div className="flex flex-col gap-3">
      {/* Week navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="flex flex-1 sm:flex-none items-center justify-between rounded-lg border"
          style={{ boxShadow: "var(--shadow-card)", borderColor: "var(--color-hairline-strong)", background: "var(--color-canvas)" }}
        >
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => go(-1)}
            className="p-2.5 sm:p-2"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm px-1 tabular-nums" style={{ color: "var(--color-ink)", opacity: loading ? 0.5 : 1 }}>
            {rangeLabel(week.days[0], week.days[6])}
          </span>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => go(1)}
            className="p-2.5 sm:p-2"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {week.today < week.days[0] || week.today > week.days[6] ? (
          <button
            type="button"
            onClick={() => load(week.today)}
            className="text-sm px-3 py-2 rounded-lg"
            style={{ color: "var(--color-primary)" }}
          >
            This week
          </button>
        ) : null}

        {canManage && (
          <button
            type="button"
            onClick={onCopy}
            disabled={copying}
            className="w-full sm:w-auto sm:ml-auto inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 sm:py-2 rounded-lg border"
            style={{ boxShadow: "var(--shadow-card)",
              borderColor: "var(--color-hairline-strong)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            <Copy size={14} />
            {copying ? "Copying…" : "Copy last week"}
          </button>
        )}
      </div>

      {(copyMsg || canUndo) && (
        <div className="flex items-center gap-3 flex-wrap">
          {copyMsg && (
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {copyMsg}
            </p>
          )}
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={undoing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border disabled:opacity-60"
              style={{
                borderColor: "var(--color-primary)",
                color: "var(--color-primary)",
                background: "var(--color-canvas)",
              }}
            >
              <Undo2 size={13} />
              {undoing ? "Undoing…" : "Undo copy"}
            </button>
          )}
        </div>
      )}

      {/* ── Phone: one day at a time ─────────────────────────────────────── */}
      <div className="md:hidden flex flex-col gap-3">
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Day of the week">
          {week.days.map((d) => {
            const active = d === activeDay;
            const isToday = d === week.today;
            const rostered = week.shifts.some((s) => s.date === d && s.kind === "shift");
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={dayHeader(d)}
                onClick={() => setPickedDay(d)}
                className="flex flex-col items-center rounded-lg py-1.5 border transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : isToday ? tint("var(--color-primary)", 55) : "var(--color-hairline-strong)",
                  background: active ? "var(--color-primary)" : "var(--color-canvas)",
                  color: active ? "var(--color-on-primary, #ffffff)" : isToday ? "var(--color-primary)" : "var(--color-ink)",
                  boxShadow: active
                    ? "0 2px 8px -2px color-mix(in srgb, var(--color-primary) 60%, transparent)"
                    : "var(--shadow-card)",
                }}
              >
                <span className="text-[11px]" style={{ color: active ? "color-mix(in srgb, var(--color-on-primary, #ffffff) 85%, transparent)" : "var(--color-ink-mute)" }}>
                  {WEEKDAY_SHORT[weekdayIndex(d)]}
                </span>
                <span className="text-base tabular-nums" style={{ fontWeight: active || isToday ? 600 : 400 }}>
                  {Number(d.slice(8))}
                </span>
                {/* A dot under any day that has someone on shift. */}
                <span
                  className="w-1 h-1 rounded-full mt-0.5"
                  style={{ background: rostered ? (active ? "var(--color-on-primary, #ffffff)" : "var(--color-primary)") : "transparent" }}
                />
              </button>
            );
          })}
        </div>

        <div className="flex items-baseline justify-between px-0.5">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {dayHeader(activeDay)}
            {activeDay === week.today && (
              <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--color-primary)" }}>
                Today
              </span>
            )}
          </p>
          <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
            {hoursLabel(dayHours(activeDay))} rostered
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {week.staff.map((st) => {
            const s = shiftOf(st.id, activeDay);
            return (
              <button
                key={st.id}
                type="button"
                disabled={!canManage}
                onClick={() => setEditing({ staffId: st.id, name: st.display_name, date: activeDay })}
                aria-label={`${st.display_name}, ${dayHeader(activeDay)}${s ? `: ${formatShift(s)}` : ": empty"}`}
                className="w-full min-h-[64px] rounded-xl border text-left flex items-stretch overflow-hidden disabled:cursor-default enabled:active:scale-[0.99] transition-transform"
                style={{ boxShadow: "var(--shadow-card)", borderColor: "var(--color-hairline-strong)", background: "var(--color-canvas)" }}
              >
                <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center gap-0.5">
                  <p className="text-sm truncate" style={{ color: "var(--color-ink)", opacity: st.is_active ? 1 : 0.5 }}>
                    {st.display_name}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {hoursLabel(weekHours(st.id))} this week ·{" "}
                    <span style={{ color: st.hourly_rate != null ? undefined : "var(--color-warning)" }}>
                      {st.hourly_rate != null ? `${cur.money2(st.hourly_rate)}/hr` : "no rate"}
                    </span>
                  </p>
                </div>
                <div className="w-[48%] shrink-0 pl-3 pr-2 py-2.5 flex items-center gap-2 text-xs" style={cellStyle(s)}>
                  <div className="flex-1 min-w-0">
                    <CellBody s={s} canManage={canManage} roomy />
                  </div>
                  {canManage && <Pencil size={13} className="shrink-0" style={{ color: "var(--color-ink-mute)" }} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tablet/desktop: the week grid ──────────────────────────────────── */}
      <div
        className="hidden md:block rounded-xl border overflow-x-auto"
        style={{ boxShadow: "var(--shadow-card)", borderColor: "var(--color-hairline-strong)", background: "var(--color-canvas)" }}
      >
        <table className="w-full border-collapse text-sm" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 text-left font-normal text-xs px-3 py-2 border-b"
                style={{
                  background: "var(--color-canvas)",
                  borderColor: "var(--color-hairline-strong)",
                  color: "var(--color-ink-mute)",
                  minWidth: 140,
                }}
              >
                Name
              </th>
              {week.days.map((d) => {
                const isToday = d === week.today;
                return (
                  <th
                    key={d}
                    className="font-normal text-xs px-2 py-2 border-b border-l text-left"
                    style={{
                      borderColor: "var(--color-hairline-strong)",
                      color: isToday ? "var(--color-primary)" : "var(--color-ink-mute)",
                      fontWeight: isToday ? 600 : 400,
                    }}
                  >
                    {dayHeader(d)}
                  </th>
                );
              })}
              <th
                className="font-normal text-xs px-3 py-2 border-b border-l text-right"
                style={{ borderColor: "var(--color-hairline-strong)", color: "var(--color-ink-mute)" }}
              >
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {week.staff.map((st) => (
              <tr key={st.id}>
                <td
                  className="sticky left-0 z-10 px-3 py-2 border-b align-top"
                  style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-strong)" }}
                >
                  <p className="truncate" style={{ color: "var(--color-ink)", opacity: st.is_active ? 1 : 0.5 }}>
                    {st.display_name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: st.hourly_rate != null ? "var(--color-ink-mute)" : "var(--color-warning)" }}
                  >
                    {st.hourly_rate != null ? `${cur.money2(st.hourly_rate)}/hr` : "No rate set"}
                  </p>
                </td>
                {week.days.map((d) => {
                  const s = shiftOf(st.id, d);
                  const isToday = d === week.today;
                  return (
                    <td
                      key={d}
                      className="border-b border-l p-1 align-top"
                      style={{
                        borderColor: "var(--color-hairline-strong)",
                        background: isToday ? tint("var(--color-primary)", 4) : undefined,
                      }}
                    >
                      <button
                        type="button"
                        disabled={!canManage}
                        aria-label={`${st.display_name}, ${dayHeader(d)}${s ? `: ${formatShift(s)}` : ": empty"}`}
                        onClick={() => setEditing({ staffId: st.id, name: st.display_name, date: d })}
                        className="group w-full min-h-[52px] rounded-md px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-default enabled:hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        style={cellStyle(s)}
                      >
                        <CellBody s={s} canManage={canManage} />
                      </button>
                    </td>
                  );
                })}
                <td
                  className="border-b border-l px-3 py-2 text-right tabular-nums align-top"
                  style={{ borderColor: "var(--color-hairline-strong)", color: "var(--color-ink)" }}
                >
                  {hoursLabel(weekHours(st.id))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                className="sticky left-0 z-10 px-3 py-2 text-xs"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
              >
                Total
              </td>
              {week.days.map((d) => (
                <td
                  key={d}
                  className="border-l px-2 py-2 text-xs tabular-nums"
                  style={{
                    borderColor: "var(--color-hairline-strong)",
                    background: "var(--color-canvas-soft)",
                    color: "var(--color-ink-mute)",
                  }}
                >
                  {hoursLabel(dayHours(d))}
                </td>
              ))}
              <td
                className="border-l px-3 py-2 text-right tabular-nums font-medium"
                style={{
                  borderColor: "var(--color-hairline-strong)",
                  background: "var(--color-canvas-soft)",
                  color: "var(--color-ink)",
                }}
              >
                {hoursLabel(totalHours)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        {week.staff.length === 0
          ? "No active staff yet."
          : `Estimated wage cost this week: ${cur.money2(totalCost)} (at current rates).`}
      </p>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? editing.name : ""}
        subtitle="Rota entry"
      >
        {editing && (
          <ShiftEditor
            key={`${editing.staffId}|${editing.date}`}
            staffId={editing.staffId}
            date={editing.date}
            existing={shiftOf(editing.staffId, editing.date)}
            suggestion={lastShiftOf(editing.staffId, editing.date)}
            onDone={() => {
              setEditing(null);
              load(week.weekStart);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
