"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelAtPeriodEndAction, disableRatibaAction, enableRatibaAction, type ActionState } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  );
}

export function CancelToggle({ cancelAtPeriodEnd }: { cancelAtPeriodEnd: boolean }) {
  const [state, action, pending] = useActionState(cancelAtPeriodEndAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="cancel" value={cancelAtPeriodEnd ? "false" : "true"} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {cancelAtPeriodEnd ? "Keep my plan" : "Cancel at end of period"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RatibaControls({ status, defaultPhone }: { status: string | null; defaultPhone: string | null }) {
  const [enableState, enable, enabling] = useActionState(enableRatibaAction, null);
  const [disableState, disable, disabling] = useActionState(disableRatibaAction, null);

  if (status === "active" || status === "requested") {
    return (
      <form action={disable} className="space-y-2">
        <p className="text-sm">
          {status === "active"
            ? "On: M-Pesa pays your renewal automatically through a standing order."
            : "Waiting for you to approve the standing order on your phone."}
        </p>
        <Button type="submit" variant="outline" size="sm" disabled={disabling}>
          Turn off automatic renewal
        </Button>
        <Feedback state={disableState} />
      </form>
    );
  }

  return (
    <form action={enable} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Approve an M-Pesa Ratiba standing order once and renewals pay themselves. Safaricom adds a small fee per
        payment. You can stop it anytime.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="ratiba-phone">M-Pesa phone number</Label>
          <Input
            id="ratiba-phone"
            name="phone"
            inputMode="tel"
            defaultValue={defaultPhone ? `0${defaultPhone.slice(3)}` : ""}
            placeholder="0712 345 678"
            required
          />
        </div>
        <Button type="submit" disabled={enabling}>
          Turn on automatic renewal
        </Button>
      </div>
      <Feedback state={enableState} />
    </form>
  );
}
