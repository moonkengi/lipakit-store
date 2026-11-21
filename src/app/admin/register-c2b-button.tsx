"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Registers this app's C2B URLs with Safaricom. Full C2B settings page arrives in M4. */
export function RegisterC2BButton() {
  const [state, setState] = useState<{ pending: boolean; message?: string; ok?: boolean }>({ pending: false });
  async function register() {
    setState({ pending: true });
    const res = await fetch("/api/admin/register-c2b", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; error?: string };
    setState({ pending: false, ok: body.ok, message: body.ok ? `Registered: ${body.description}` : body.error });
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={register} disabled={state.pending}>
        {state.pending ? "Registering…" : "Register C2B URLs with Safaricom"}
      </Button>
      {state.message && (
        <p className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
