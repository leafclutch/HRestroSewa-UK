"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

// Light / dark / follow the device, remembered on this device. The same `.dark`
// class the main app uses, so every shared screen flips with it. The pre-paint
// script in app/layout.tsx applies the saved choice before first render, so there is
// no flash; this keeps it in sync afterwards (and live, in "System" mode).

export type ThemeMode = "system" | "light" | "dark";
export const THEME_KEY = "rota.theme";

// Matches --color-canvas-soft in each theme, so the phone's status bar and the page
// read as one surface.
const BAR = { light: "#f6f9fc", dark: "#07080d" };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(mode: ThemeMode) {
  const dark =
    mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? BAR.dark : BAR.light));
}

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

export function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    setMode(readMode());
  }, []);

  useEffect(() => {
    apply(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const choose = (m: ThemeMode) => {
    setMode(m);
    try {
      if (m === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, m);
    } catch {
      // applies for this visit only
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg p-0.5 gap-0.5 shrink-0"
      style={{ background: "var(--color-canvas)", border: "1px solid var(--color-hairline-strong)", boxShadow: "var(--shadow-card)" }}
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => choose(m)}
            className="w-9 h-8 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            style={{
              background: active ? "var(--color-primary)" : "transparent",
              color: active ? "var(--color-on-primary, #ffffff)" : "var(--color-ink-mute)",
            }}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
