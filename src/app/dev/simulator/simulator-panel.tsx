"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { outcomeLabels, simulatorOutcomes, type SimulatorOutcome } from "@/lib/mpesa/simulator-outcomes";
import type { SimulatedCheckout, SimulatorSettings } from "@/lib/mpesa/simulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Snapshot = { settings: SimulatorSettings; checkouts: SimulatedCheckout[] };

export function SimulatorPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/dev/simulate", { cache: "no-store" });
    if (res.ok) setSnap((await res.json()) as Snapshot);
  }, []);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 3_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  async function update(patch: Partial<SimulatorSettings> | { action: "poll" }) {
    const res = await fetch("/api/dev/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if ("summary" in body) setMessage(`Poller: ${JSON.stringify(body.summary)}`);
    await refresh();
  }

  if (!snap) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Next STK push</CardTitle>
          <CardDescription>
            Applies to the next payment started from{" "}
            <Link href="/pricing" className="underline">
              checkout
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Outcome</legend>
            {simulatorOutcomes.map((o) => (
              <label
                key={o}
                className="flex items-center gap-2 rounded-md border p-2 text-sm has-checked:border-primary"
              >
                <input
                  type="radio"
                  name="outcome"
                  checked={snap.settings.nextOutcome === o}
                  onChange={() => update({ nextOutcome: o as SimulatorOutcome })}
                />
                {outcomeLabels[o]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="delay">Customer response delay (ms)</Label>
              <Input
                id="delay"
                type="number"
                min={0}
                defaultValue={snap.settings.delayMs}
                onBlur={(e) => update({ delayMs: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="late">Late callback delay (ms)</Label>
              <Input
                id="late"
                type="number"
                min={0}
                defaultValue={snap.settings.lateCallbackDelayMs}
                onBlur={(e) => update({ lateCallbackDelayMs: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => update({ action: "poll" })}>
              Run poller now
            </Button>
            <span className="text-xs text-muted-foreground">
              Runs automatically every 20s in simulator mode; it only checks pushes older than 60s.
            </span>
          </div>
          {message && <p className="font-mono text-xs">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent simulated pushes</CardTitle>
          <CardDescription>In memory; cleared when the dev server restarts.</CardDescription>
        </CardHeader>
        <CardContent>
          {snap.checkouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {snap.checkouts.map((c) => (
                <li key={c.checkoutRequestId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-mono text-xs">{c.accountReference}</span>
                  <span>KES {c.amountKes}</span>
                  <Badge variant="outline">{outcomeLabels[c.outcome]}</Badge>
                  <span className="text-xs text-muted-foreground">callbacks sent: {c.callbacksSent}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
