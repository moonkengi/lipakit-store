"use client";

/**
 * A form bound to an admin server action, with inline success/error feedback.
 * Children are the fields and the submit button.
 */
import { useActionState, type ReactNode } from "react";
import type { AdminActionState } from "./actions";

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state && (
        <p
          className={`mt-2 text-sm ${state.ok ? "text-muted-foreground" : "text-destructive"}`}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
