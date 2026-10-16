import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getMyRota } from "@/app/actions/rota";
import { getCurrentCurrency } from "@/lib/currency-server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { MyRotaView } from "@/components/rota/my-rota-view";

// My Rota — the staff member's own week, read-only, so they can check their shifts
// before they come in. Only their own rows are ever fetched (getMyRota filters on
// the caller); pay appears only for someone who already holds a payroll right.
// The markup is shared with the Rota PWA (components/rota/my-rota-view.tsx).

export default async function MyRotaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireRestaurantStaff();
  const { week } = await searchParams;
  const rota = await getMyRota(week);
  if (!rota) redirect("/employee/dashboard");

  const cur = rota.estimatedPay != null ? await getCurrentCurrency() : null;

  return (
    <div className="p-4 sm:p-5 max-w-xl mx-auto">
      <RealtimeRefresh topics={["payroll"]} />

      <h1
        className="text-2xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        My Rota
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Your shifts for the week. Times may be subject to change.
      </p>

      <MyRotaView
        rota={rota}
        money={cur ? cur.money2 : null}
        weekLink={(w, content, attrs) => (
          <Link href={w ? `/employee/rota?week=${w}` : "/employee/rota"} {...attrs}>
            {content}
          </Link>
        )}
      />
    </div>
  );
}
