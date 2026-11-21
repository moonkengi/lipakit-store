"use client";

import { useActionState } from "react";
import { features } from "@/config/features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "./actions";
import { PhoneLogin } from "./phone-login";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="space-y-2 text-center" role="status">
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <strong>{state.email}</strong>. You can close this tab.
        </p>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : initialError;

  return (
    <div className="space-y-6">
      {features.magicLink && (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      )}

      {features.magicLink && features.googleAuth && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {features.googleAuth && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="outline" className="w-full">
            Continue with Google
          </Button>
        </form>
      )}

      {features.phoneOtp && <PhoneLogin next={next} />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
