/**
 * Server-side PostHog events for things that must be counted exactly
 * (checkouts, payments), so ad-blockers can't hide them. Never throws and
 * never blocks: call it from after() or ignore the promise.
 */
import "server-only";
import { publicEnv } from "@/lib/env";
import { POSTHOG_HOSTS } from "./hosts";

export async function track(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const key = publicEnv.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  try {
    await fetch(`${POSTHOG_HOSTS[publicEnv.NEXT_PUBLIC_POSTHOG_REGION].api}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: "lipakit-server" },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.warn("[analytics] event not sent:", event, (error as Error).message);
  }
}
