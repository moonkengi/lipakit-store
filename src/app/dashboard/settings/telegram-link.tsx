"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { linkTelegramAction, unlinkTelegramAction, type LinkState } from "./actions";

export function TelegramLink({ linked }: { linked: boolean }) {
  const [state, action, pending] = useActionState<LinkState>(linkTelegramAction, null);

  if (linked) {
    return (
      <form action={unlinkTelegramAction} className="space-y-2">
        <p className="text-sm">Linked. Payment and renewal messages also arrive in Telegram.</p>
        <Button type="submit" variant="outline" size="sm">
          Unlink Telegram
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      {state?.link ? (
        <div className="space-y-2 text-sm">
          <Button asChild size="sm">
            <a href={state.link} target="_blank" rel="noreferrer">
              Open Telegram to finish linking
            </a>
          </Button>
          <p className="text-muted-foreground">
            Or send <code>/start {state.code}</code> to the bot. The code works once and expires in 15 minutes. Refresh
            this page afterwards.
          </p>
        </div>
      ) : (
        <form action={action}>
          <Button type="submit" size="sm" disabled={pending}>
            Link Telegram
          </Button>
        </form>
      )}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
