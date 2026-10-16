"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/format-time";

// The restaurant's wall clock, not the viewer's: an owner checking in from
// abroad (or a laptop left on another zone) still sees the time the books use.
const timeFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dateFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
// "GMT" in winter, "BST" in summer — says which offset is in force today.
const zoneFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  timeZoneName: "short",
});

const zoneName = (d: Date) =>
  zoneFmt.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";

export function CurrentTimeCard() {
  // Null until mounted: the server's render and the browser's first paint happen
  // seconds apart, so rendering a time on the server would be a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Align ticks to the second boundary so the display never lags by ~1s.
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 1000);
    }, 1000 - (Date.now() % 1000));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <div
      className="rounded-xl border px-5 py-4 flex items-center gap-4 shadow-xs"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      aria-live="off"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--color-canvas-soft)" }}
      >
        <Clock size={18} strokeWidth={1.5} style={{ color: "var(--color-primary)" }} />
      </div>
      <div className="min-w-0">
        <p
          className="text-3xl tabular-nums"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.5px" }}
        >
          {now ? timeFmt.format(now) : "--:--:--"}
          {now && (
            <span className="text-sm ml-2 align-middle" style={{ color: "var(--color-ink-mute)", letterSpacing: 0 }}>
              {zoneName(now)}
            </span>
          )}
        </p>
        <p className="text-sm mt-0.5 font-light truncate" style={{ color: "var(--color-ink-mute)" }}>
          {now ? dateFmt.format(now) : "Current time"}
        </p>
      </div>
    </div>
  );
}
