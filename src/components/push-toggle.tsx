"use client";

/**
 * Turn browser notifications on or off for this device. Requires
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY; renders nothing when push isn't configured.
 */
import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";
import { Button } from "@/components/ui/button";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "denied" | "off" | "on";

export function PushToggle() {
  const key = publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const reg = await navigator.serviceWorker.register("/sw.js");
      return (await reg.pushManager.getSubscription()) ? ("on" as const) : ("off" as const);
    })()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return null;

  async function turnOn() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key!),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("save failed");
      setState("on");
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "off");
      setError("Couldn't turn on notifications. Check your browser's notification settings.");
    }
  }

  async function turnOff() {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState("off");
  }

  return (
    <div className="space-y-2">
      {state === "on" && (
        <Button variant="outline" size="sm" onClick={turnOff}>
          Turn off notifications on this device
        </Button>
      )}
      {state === "off" && (
        <Button size="sm" onClick={turnOn}>
          Turn on notifications on this device
        </Button>
      )}
      {state === "denied" && (
        <p className="text-sm text-muted-foreground">
          Notifications are blocked for this site in your browser settings.
        </p>
      )}
      {state === "unsupported" && (
        <p className="text-sm text-muted-foreground">This browser doesn&apos;t support notifications.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
