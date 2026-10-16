"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lastSlug } from "@rota/lib/api";

// The bare domain. The real entry is the restaurant's own link (/<slug>), which this
// device remembers — so an installed app opened from the home screen goes straight back
// to it. Without one, the person can paste the code from the link their manager sent.

export function RotaHome() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    const slug = lastSlug();
    if (slug) router.replace(`/${encodeURIComponent(slug)}`);
    else setChecked(true);
  }, [router]);

  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4"
      style={{ background: "var(--color-canvas-soft)" }}
    >
      {checked && (
        <div
          className="w-full max-w-md rounded-xl border p-6 flex flex-col gap-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <div>
            <h1 className="text-2xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
              HRestroSewa Rota
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-ink-mute)" }}>
              Open the rota link your manager sent you. Or enter the restaurant code from that link
              (the part after the last “/”).
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const slug = code.trim().replace(/^.*\//, "");
              if (slug) router.push(`/${encodeURIComponent(slug)}`);
            }}
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="restaurant-code"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="Restaurant code"
            />
            <Button type="submit" variant="primary" disabled={!code.trim()}>
              Open
            </Button>
          </form>
        </div>
      )}
    </main>
  );
}
