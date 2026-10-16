import "server-only";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { pinToAuthPassword } from "@/lib/auth/pin-password";

// The staff PIN check, shared by both ways in:
//   - the main app's `loginWithPin` server action, passing its COOKIE client, so the
//     session lands in the browser's cookies exactly as before;
//   - the Rota PWA's `/api/rota/login`, passing a client that persists nothing, so the
//     session comes back as tokens the PWA keeps itself (it lives on another origin
//     and cannot share the main app's cookies).
// One implementation, so the lockout can never be skipped by picking the other door.

export type PinLoginResult = { error: string } | { session: Session | null };

// A locked-out person is told how long is left, in the coarsest unit that
// still reads as true — "1 minute" for anything under two, so a 90-second wait
// doesn't claim to be "0 minutes".
function minutesLeft(retryAfter: string): number {
  const ms = new Date(retryAfter).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}

export async function attemptPinLogin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  restaurantUserId: string,
  pin: string
): Promise<PinLoginResult> {
  if (!restaurantUserId || !/^[0-9]{4}$/.test(pin)) {
    return { error: "PIN must be exactly 4 digits." };
  }

  const service = createServiceClient();

  // Checked BEFORE ever calling Supabase Auth — a lockout must refuse even the
  // right PIN, not just a wrong one, or it isn't really a lockout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lockRows } = await (service as any).rpc("pin_lockout_status", {
    p_restaurant_user_id: restaurantUserId,
  });
  const lock = lockRows?.[0];
  if (lock?.locked) {
    const mins = minutesLeft(lock.retry_after);
    return { error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  const syntheticEmail = `emp-${restaurantUserId}@restrosewa.internal`;
  // The PIN is stored through `pinToAuthPassword` (Supabase Auth rejects passwords
  // under 6 characters). Accounts made before that still hold the raw PIN: try it
  // second, and on success move the account onto the mapped password. Either way
  // this is ONE attempt for the lockout, recorded once below.
  let { data, error } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: pinToAuthPassword(pin),
  });
  if (error) {
    const legacy = await supabase.auth.signInWithPassword({ email: syntheticEmail, password: pin });
    if (!legacy.error && legacy.data.user) {
      error = null;
      data = legacy.data;
      // Best-effort: a failure here just means the fallback is used again next time.
      await createAdminClient()
        .auth.admin.updateUserById(legacy.data.user.id, { password: pinToAuthPassword(pin) })
        .catch(() => {});
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).rpc("record_pin_attempt", {
    p_restaurant_user_id: restaurantUserId,
    p_success: !error,
  });

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: afterRows } = await (service as any).rpc("pin_lockout_status", {
      p_restaurant_user_id: restaurantUserId,
    });
    const justLocked = afterRows?.[0]?.locked;
    return {
      error: justLocked
        ? `Incorrect PIN. Too many wrong attempts — try again in 30 minutes.`
        : "Incorrect PIN. Please try again.",
    };
  }

  return { session: data.session ?? null };
}
