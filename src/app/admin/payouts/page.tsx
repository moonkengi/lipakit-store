import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { maskPhone } from "@/lib/mpesa";
import { b2cEnabled } from "@/lib/payments/mpesa-client";
import { createClient } from "@/lib/supabase/server";
import { formatKes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionForm } from "../action-form";
import { createPayoutAction } from "../actions";
import { dateTime, PageHeader, StatusBadge, Table, Td } from "../ui";

export default function PayoutsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts (B2C)"
        description="Send money to an M-Pesa number: refunds, withdrawals, rewards. Every payout is audited and capped per day."
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Payouts />
      </Suspense>
    </div>
  );
}

async function Payouts() {
  await connection();
  await requireAdmin();
  const env = getServerEnv();
  const { data: payouts } = await (
    await createClient()
  )
    .from("payouts")
    .select("id, created_at, phone, amount_kes, reason, status, mpesa_receipt, result_desc, receiver_name")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <>
      {b2cEnabled() ? (
        <Card>
          <CardHeader>
            <CardTitle>New payout</CardTitle>
            <CardDescription>
              Daily limit KES {env.B2C_DAILY_LIMIT_KES.toLocaleString("en-KE")} (B2C_DAILY_LIMIT_KES).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={createPayoutAction} className="grid gap-4 sm:grid-cols-2">
              {/* A fresh key per page load: resubmitting this form can't send twice. */}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <div className="space-y-2">
                <Label htmlFor="phone">M-Pesa number</Label>
                <Input id="phone" name="phone" inputMode="tel" placeholder="0712 345 678" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (KES)</Label>
                <Input id="amount" name="amountKes" type="number" min={1} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reason">Reason</Label>
                <Input id="reason" name="reason" placeholder="Refund for order LKAB12CD34" required maxLength={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="command">Type</Label>
                <select id="command" name="command" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="BusinessPayment">Business payment</option>
                  <option value="SalaryPayment">Salary</option>
                  <option value="PromotionPayment">Promotion</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="confirm" required /> I&apos;ve checked the number and amount. This sends
                real money.
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">Send payout</Button>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          Payouts are off. Set MPESA_B2C_INITIATOR and MPESA_B2C_SECURITY_CREDENTIAL (and MPESA_B2C_SHORTCODE if your
          B2C shortcode differs) to turn them on.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        <strong>Unconfirmed (timeout)</strong> means M-Pesa didn&apos;t give a clear answer: the money may have been
        sent. Check your M-Pesa statement before sending again.
      </p>
      <Table head={["Created", "To", "Amount", "Reason", "Status", "M-Pesa", "Result"]} empty={!payouts?.length}>
        {payouts?.map((p) => (
          <tr key={p.id}>
            <Td>{dateTime.format(new Date(p.created_at))}</Td>
            <Td>{p.receiver_name ?? maskPhone(p.phone)}</Td>
            <Td>{formatKes(p.amount_kes)}</Td>
            <Td className="max-w-48">{p.reason}</Td>
            <Td>
              <StatusBadge status={p.status === "timeout" ? "unconfirmed" : p.status} />
            </Td>
            <Td mono>{p.mpesa_receipt ?? "—"}</Td>
            <Td className="max-w-56 text-xs text-muted-foreground">{p.result_desc}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
