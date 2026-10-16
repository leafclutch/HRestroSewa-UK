export const dynamic = "force-static";

export default function Offline() {
  return (
    <main
      className="min-h-dvh flex items-center justify-center px-4"
      style={{ background: "var(--color-canvas-soft)" }}
    >
      <div className="max-w-sm text-center">
        <h1 className="text-xl mb-2" style={{ color: "var(--color-ink)", fontWeight: 300 }}>
          You&apos;re offline
        </h1>
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          The rota needs a connection to show up-to-date shifts. Reconnect and try again.
        </p>
      </div>
    </main>
  );
}
