"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { pinLogin, type RestaurantInfo } from "@rota/lib/api";

// Pick your name, enter the same 4-digit PIN as the main app. The look follows the
// main app's staff login (app/(auth)/login/_components/staff-login.tsx); the PIN is
// checked by the main app's backend with the same lockout.

const PIN_LENGTH = 4;
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

type Staff = RestaurantInfo["staff"][number];

export function PinLogin({
  slug,
  staff,
  onSignedIn,
}: {
  slug: string;
  staff: Staff[];
  onSignedIn: () => void;
}) {
  const [who, setWho] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      if (!who || value.length !== PIN_LENGTH || pending) return;
      setPending(true);
      setError(null);
      try {
        await pinLogin(slug, who.id, value);
        onSignedIn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not sign in. Please try again.");
        setPin("");
      } finally {
        setPending(false);
      }
    },
    [who, pending, slug, onSignedIn]
  );

  const digit = (d: string) => {
    if (pending) return;
    setError(null);
    // Computed outside the state updater: updaters must be pure (strict mode runs them
    // twice), and a submit inside one would send the PIN twice.
    const next = pin.length < PIN_LENGTH ? pin + d : pin;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };
  const back = () => setPin((p) => p.slice(0, -1));

  // Typing works too — a manager on a laptop shouldn't have to click the keypad.
  useEffect(() => {
    if (!who) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) digit(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!who) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-center mb-2" style={{ color: "var(--color-ink-mute)" }}>
          Who are you?
        </p>
        {staff.length === 0 && (
          <p className="text-sm text-center" style={{ color: "var(--color-ink-mute)" }}>
            No staff accounts yet.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setWho(s);
                setPin("");
                setError(null);
              }}
              className="flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg border text-left transition-colors min-w-0"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
            >
              <span className="font-medium text-sm truncate max-w-full" style={{ color: "var(--color-ink)" }}>
                {s.display_name}
              </span>
              <span className="text-xs truncate max-w-full" style={{ color: "var(--color-ink-mute)" }}>
                {s.title || (s.role === "restaurant_admin" ? "Admin" : "Staff")}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => setWho(null)}
        className="self-start text-sm mb-2"
        style={{ color: "var(--color-primary)" }}
      >
        ← Not you?
      </button>
      <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
        {who.display_name}
      </p>
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Enter your 4-digit PIN
      </p>

      <div className="flex gap-3 justify-center my-6" aria-label={`${pin.length} of 4 digits entered`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className="w-3 h-3 rounded-full transition-all duration-150"
            style={{ background: i < pin.length ? "var(--color-lemon)" : "var(--color-hairline)" }}
          />
        ))}
      </div>

      {error && (
        <p
          className="text-sm rounded-md px-3 py-2 w-full text-center"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 w-full max-w-[240px] mx-auto">
        {KEYPAD.map((key, i) =>
          key === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => (key === "⌫" ? back() : digit(key))}
              onMouseDown={(e) => e.preventDefault()}
              aria-label={key === "⌫" ? "Delete" : key}
              className="h-14 rounded-lg text-xl font-light flex items-center justify-center select-none disabled:opacity-60"
              style={
                key === "⌫"
                  ? { background: "var(--color-hairline)", color: "var(--color-ink-mute)" }
                  : { background: "var(--color-canvas-soft)", color: "var(--color-ink)" }
              }
            >
              {key}
            </button>
          )
        )}
      </div>

      <Button
        type="button"
        variant="primary"
        className="w-full max-w-[240px] mt-4"
        disabled={pending || pin.length !== PIN_LENGTH}
        onClick={() => void submit(pin)}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </div>
  );
}
