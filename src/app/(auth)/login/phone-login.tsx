"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPhoneCode, verifyPhoneCode, type PhoneState } from "./phone-actions";

/** Two steps: phone number → SMS code. */
export function PhoneLogin({ next }: { next: string }) {
  const [sent, send, sending] = useActionState<PhoneState, FormData>(sendPhoneCode, { step: "phone" });
  const [verified, verify, verifying] = useActionState<PhoneState, FormData>(verifyPhoneCode, { step: "phone" });

  if (sent.step === "code") {
    return (
      <form action={verify} className="space-y-3">
        <input type="hidden" name="phone" value={sent.phone} />
        <input type="hidden" name="next" value={next} />
        <div className="space-y-2">
          <Label htmlFor="otp">Code sent to {sent.display}</Label>
          <Input id="otp" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={10} />
        </div>
        <Button type="submit" className="w-full" disabled={verifying}>
          {verifying ? "Checking…" : "Sign in"}
        </Button>
        {verified.step === "code" && verified.error && (
          <p className="text-sm text-destructive" role="alert">
            {verified.error}
          </p>
        )}
      </form>
    );
  }

  return (
    <form action={send} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="login-phone">Phone number</Label>
        <Input id="login-phone" name="phone" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" required />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={sending}>
        {sending ? "Sending…" : "Text me a sign-in code"}
      </Button>
      {sent.step === "phone" && sent.error && (
        <p className="text-sm text-destructive" role="alert">
          {sent.error}
        </p>
      )}
    </form>
  );
}
