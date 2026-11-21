"use client";

/**
 * PostHog in the browser: page views (including client-side navigation),
 * page leaves and session recordings (all form inputs masked). Does nothing
 * unless NEXT_PUBLIC_POSTHOG_KEY is set.
 */
import { useEffect } from "react";
import posthog from "posthog-js";
import { POSTHOG_HOSTS } from "./hosts";

type Props = { apiKey?: string; region: "eu" | "us" };

export function Analytics({ apiKey, region }: Props) {
  useEffect(() => {
    if (!apiKey || posthog.__loaded) return;
    posthog.init(apiKey, {
      api_host: "/ingest",
      ui_host: POSTHOG_HOSTS[region].ui,
      person_profiles: "identified_only",
      capture_pageview: "history_change",
      capture_pageleave: true,
      session_recording: { maskAllInputs: true },
    });
  }, [apiKey, region]);
  return null;
}

/** Link the visitor's events to their account (by ID only, no personal details). */
export function IdentifyUser({ userId, role }: { userId: string; role: string }) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    posthog.identify(userId, { role });
  }, [userId, role]);
  return null;
}
