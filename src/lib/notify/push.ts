/**
 * Web push to browsers that opted in (users and admins). Uses the standard
 * `web-push` library with your own VAPID keys; no third-party account needed.
 * Subscriptions the browser has revoked (HTTP 404/410) are removed.
 */
import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { getServerEnv, publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushPayload = { title: string; body: string; url?: string };

let configured: boolean | undefined;

export function pushEnabled(): boolean {
  if (configured === undefined) {
    const env = getServerEnv();
    configured = Boolean(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
    if (configured)
      setVapidDetails(env.VAPID_SUBJECT!, publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }
  return configured;
}

/** Push to every browser of the given users. Returns how many deliveries succeeded. */
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!pushEnabled() || userIds.length === 0) return 0;
  const db = createAdminClient();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  let delivered = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 },
        );
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("[push] delivery failed", status, (error as Error).message);
      }
    }),
  );
  return delivered;
}
