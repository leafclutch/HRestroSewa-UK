import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  SHIFT_KIND_LABEL,
  addDays,
  breakLabel,
  crossesMidnight,
  dayHeader,
  hoursLabel,
  rangeLabel,
  shiftPaidHours,
  type RotaShift,
} from "@/lib/rota";
import type { MyRota } from "@/lib/rota-service";

// My Rota — the staff member's own week, read-only. Purely presentational, so it
// renders the same in the main app (a server page with ?week= links) and in the Rota
// PWA (a client screen with buttons). Week navigation is delegated to `weekLink`.

const KIND_TONE: Record<RotaShift["kind"], string> = {
  shift: "var(--color-primary)",
  holiday: "var(--color-success)",
  sick: "var(--color-danger)",
  off: "var(--color-ink-mute)",
};

export type WeekLinkRenderer = (
  /** The Monday to go to, or null for "this week". */
  week: string | null,
  content: ReactNode,
  attrs: { className: string; style?: CSSProperties; "aria-label"?: string }
) => ReactNode;

const navStyle: CSSProperties = {
  borderColor: "var(--color-hairline)",
  color: "var(--color-ink-mute)",
  background: "var(--color-canvas)",
};

export function MyRotaView({
  rota,
  money,
  weekLink,
}: {
  rota: MyRota;
  /** Formats pay — only passed for someone who may see it. */
  money?: ((n: number) => string) | null;
  weekLink: WeekLinkRenderer;
}) {
  const byDate = new Map(rota.shifts.map((s) => [s.date, s]));
  const isThisWeek = rota.today >= rota.days[0] && rota.today <= rota.days[6];

  return (
    <>
      {/* Week switcher */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {weekLink(addDays(rota.weekStart, -7), <ChevronLeft size={16} />, {
          className: "p-2 rounded-lg border",
          style: navStyle,
          "aria-label": "Previous week",
        })}
        <div className="text-center">
          <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
            {rangeLabel(rota.days[0], rota.days[6])}
          </p>
          {!isThisWeek &&
            weekLink(null, "Back to this week", {
              className: "text-xs",
              style: { color: "var(--color-primary)" },
            })}
        </div>
        {weekLink(addDays(rota.weekStart, 7), <ChevronRight size={16} />, {
          className: "p-2 rounded-lg border",
          style: navStyle,
          "aria-label": "Next week",
        })}
      </div>

      {/* The seven days */}
      <div
        className="rounded-xl border divide-y"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        {rota.days.map((d) => {
          const s = byDate.get(d);
          const isToday = d === rota.today;
          const start = s?.actual_start ?? s?.planned_start ?? null;
          const end = s?.actual_end ?? s?.planned_end ?? null;
          return (
            <div
              key={d}
              className="flex items-center gap-3 px-4 py-3"
              style={{
                borderColor: "var(--color-hairline)",
                background: isToday ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : undefined,
              }}
            >
              <div className="w-24 shrink-0">
                <p
                  className="text-sm"
                  style={{ color: isToday ? "var(--color-primary)" : "var(--color-ink)", fontWeight: isToday ? 600 : 400 }}
                >
                  {dayHeader(d)}
                </p>
                {isToday && (
                  <p className="text-[11px]" style={{ color: "var(--color-primary)" }}>Today</p>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {!s ? (
                  <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>—</p>
                ) : s.kind === "shift" ? (
                  <>
                    <p className="text-sm flex items-center gap-1.5 tabular-nums" style={{ color: "var(--color-ink)" }}>
                      <Clock size={13} style={{ color: KIND_TONE.shift }} />
                      {start}–{end}
                      {crossesMidnight(start, end) && (
                        <span className="text-[11px]" style={{ color: "var(--color-ink-mute)" }}>(+1 day)</span>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {[
                        s.role_code,
                        hoursLabel(shiftPaidHours(s)),
                        breakLabel(s) || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </>
                ) : (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ color: KIND_TONE[s.kind], background: `color-mix(in srgb, ${KIND_TONE[s.kind]} 14%, transparent)` }}
                  >
                    {s.kind === "sick" ? "Sickness" : SHIFT_KIND_LABEL[s.kind]}
                    {s.kind === "holiday" && (s.paid_hours ?? 0) > 0 && ` · ${hoursLabel(s.paid_hours ?? 0)}`}
                  </span>
                )}
                {s?.notes && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{s.notes}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="mt-3 rounded-xl border px-4 py-3 flex items-center justify-between"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>Total this week</span>
        <span className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>
          {hoursLabel(rota.totalHours)}
          {money && rota.estimatedPay != null && ` · ${money(rota.estimatedPay)}`}
        </span>
      </div>

      <p className="text-xs mt-3" style={{ color: "var(--color-ink-mute)" }}>
        Something wrong with your shifts? Speak to your manager.
      </p>
    </>
  );
}
