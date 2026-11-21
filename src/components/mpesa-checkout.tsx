"use client";

/**
 * <MpesaCheckout />: phone number → STK push → "check your phone" → live result.
 *
 * Status updates arrive over Supabase Realtime (RLS limits them to the user's
 * own orders), with polling as a fallback in case the socket can't connect.
 * The server decides the final status; this component only displays it.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/supabase/database.types";
import { formatKes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  plan: { code: string; name: string; priceKes: number };
  /** Pre-filled phone, e.g. from the user's profile (2547XXXXXXXX). */
  defaultPhone?: string | null;
};

type State =
  | { step: "form"; error?: string }
  | { step: "sending" }
  | { step: "waiting"; orderId: string; accountRef: string }
  | { step: "done"; status: Exclude<OrderStatus, "pending">; reason: string | null };

const POLL_INTERVAL_MS = 4_000;
/** The server expires a push after 10 minutes; stop watching a little after that. */
const GIVE_UP_AFTER_MS = 11 * 60_000;

export function MpesaCheckout({ plan, defaultPhone }: Props) {
  const [state, setState] = useState<State>({ step: "form" });
  const [phone, setPhone] = useState(defaultPhone ? `0${defaultPhone.slice(3)}` : "");

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setState({ step: "sending" });
    try {
      const res = await fetch("/api/mpesa/stk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: plan.code, phone }),
      });
      const body = (await res.json()) as { orderId?: string; accountRef?: string; error?: string };
      if (!res.ok || !body.orderId || !body.accountRef) {
        setState({ step: "form", error: body.error ?? "Something went wrong. Please try again." });
        return;
      }
      setState({ step: "waiting", orderId: body.orderId, accountRef: body.accountRef });
    } catch {
      setState({ step: "form", error: "We couldn't reach the server. Check your connection and try again." });
    }
  }

  if (state.step === "waiting") {
    return (
      <OrderWatcher
        orderId={state.orderId}
        accountRef={state.accountRef}
        onDone={(status, reason) => setState({ step: "done", status, reason })}
      />
    );
  }

  if (state.step === "done") {
    return <Result status={state.status} reason={state.reason} onRetry={() => setState({ step: "form" })} />;
  }

  const error = state.step === "form" ? state.error : undefined;
  return (
    <form onSubmit={start} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="mpesa-phone">M-Pesa phone number</Label>
        <Input
          id="mpesa-phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          aria-invalid={error ? true : undefined}
        />
      </div>
      <Button type="submit" className="w-full" disabled={state.step === "sending"}>
        {state.step === "sending" ? <Loader2 className="animate-spin" /> : null}
        Pay {formatKes(plan.priceKes)} with M-Pesa
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function OrderWatcher({
  orderId,
  accountRef,
  onDone,
}: {
  orderId: string;
  accountRef: string;
  onDone: (status: Exclude<OrderStatus, "pending">, reason: string | null) => void;
}) {
  const [gaveUp, setGaveUp] = useState(false);
  // Keep the latest callback without re-subscribing when the parent re-renders.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const supabase = createClient();
    let finished = false;

    const handle = (row: { status: OrderStatus; status_reason: string | null } | null) => {
      if (finished || !row || row.status === "pending") return;
      finished = true;
      onDoneRef.current(row.status, row.status_reason);
    };

    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => handle(payload.new as { status: OrderStatus; status_reason: string | null }),
      )
      .subscribe();

    const check = async () => {
      const { data } = await supabase.from("orders").select("status, status_reason").eq("id", orderId).maybeSingle();
      handle(data);
    };
    const poll = setInterval(check, POLL_INTERVAL_MS);
    const giveUp = setTimeout(() => setGaveUp(true), GIVE_UP_AFTER_MS);

    return () => {
      finished = true;
      clearInterval(poll);
      clearTimeout(giveUp);
      void supabase.removeChannel(channel);
    };
  }, [orderId]);

  return (
    <div className="space-y-3 text-center" role="status" aria-live="polite">
      <Smartphone className="mx-auto size-10 text-primary" />
      <p className="font-medium">Check your phone</p>
      <p className="text-sm text-muted-foreground">
        Enter your M-Pesa PIN on the prompt to complete the payment. This page updates by itself.
      </p>
      {gaveUp ? (
        <p className="text-sm text-muted-foreground">
          Still waiting for M-Pesa. If you paid, it will show in your payment history shortly (reference{" "}
          <span className="font-mono">{accountRef}</span>).
        </p>
      ) : (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function Result({
  status,
  reason,
  onRetry,
}: {
  status: Exclude<OrderStatus, "pending">;
  reason: string | null;
  onRetry: () => void;
}) {
  if (status === "paid") {
    return (
      <div className="space-y-3 text-center" role="status">
        <CheckCircle2 className="mx-auto size-10 text-primary" />
        <p className="font-medium">Payment received</p>
        <p className="text-sm text-muted-foreground">Thank you! A receipt will appear in your payment history.</p>
        <Button asChild variant="outline">
          <a href="/dashboard">Go to dashboard</a>
        </Button>
      </div>
    );
  }
  if (status === "needs_review") {
    return (
      <div className="space-y-3 text-center" role="status">
        <Loader2 className="mx-auto size-10 text-muted-foreground" />
        <p className="font-medium">We received a payment and are checking it</p>
        <p className="text-sm text-muted-foreground">
          Something didn&apos;t match, so a person will confirm it. No need to pay again.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center" role="alert">
      <XCircle className="mx-auto size-10 text-destructive" />
      <p className="font-medium">Payment not completed</p>
      <p className="text-sm text-muted-foreground">{reason ?? "The payment didn't go through."}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
