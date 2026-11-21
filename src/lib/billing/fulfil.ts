/**
 * Receipt fulfilment: after an order is paid, the database has already created
 * the receipt row (atomically, in billing_apply_paid_order). This step does the
 * slow, fallible parts: build the PDF, store it, and email/SMS the customer.
 *
 * Every step records its own timestamp (pdf_path, emailed_at, sms_at), so it's
 * safe to run repeatedly: callbacks run it straight after settling, and the
 * every-minute poller sweeps up anything that failed.
 */
import "server-only";
import { siteConfig } from "@/config/site";
import { maskPhone } from "@/lib/mpesa";
import { notifyRecipient, getNotifier } from "@/lib/notify";
import { paymentReceived } from "@/lib/notify/messages";
import { buildReceiptPdf } from "@/lib/receipts/pdf";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "receipts";
/** Don't keep retrying notifications for very old receipts. */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "Africa/Nairobi" });

type ReceiptRow = {
  id: string;
  number: string;
  created_at: string;
  pdf_path: string | null;
  emailed_at: string | null;
  sms_at: string | null;
  order_id: string;
};

/** Everything a receipt needs, gathered in a few simple queries. */
async function loadReceiptContext(receipt: ReceiptRow) {
  const db = createAdminClient();
  const { data: order, error } = await db
    .from("orders")
    .select("id, user_id, purpose, amount_kes, account_ref, paid_at, plan_id, subscription_id")
    .eq("id", receipt.order_id)
    .single();
  if (error || !order) throw new Error(`receipt ${receipt.number}: order not found`);

  const [{ data: profile }, { data: tx }, { data: plan }, { data: sub }] = await Promise.all([
    db.from("profiles").select("full_name, email, phone, telegram_chat_id").eq("id", order.user_id).single(),
    db
      .from("mpesa_transactions")
      .select("mpesa_receipt, phone")
      .eq("order_id", order.id)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    order.plan_id ? db.from("plans").select("name").eq("id", order.plan_id).single() : Promise.resolve({ data: null }),
    order.subscription_id
      ? db
          .from("subscriptions")
          .select("current_period_start, current_period_end")
          .eq("id", order.subscription_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);
  return { order, profile, tx, plan, sub };
}

export async function ensureReceiptPdf(receipt: ReceiptRow): Promise<string> {
  if (receipt.pdf_path) return receipt.pdf_path;
  const ctx = await loadReceiptContext(receipt);
  const pdf = await renderPdf(receipt, ctx);
  const path = `${ctx.order.user_id}/${receipt.number}.pdf`;
  const db = createAdminClient();
  const { error } = await db.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`receipt ${receipt.number}: upload failed: ${error.message}`);
  await db.from("receipts").update({ pdf_path: path }).eq("id", receipt.id);
  receipt.pdf_path = path;
  return path;
}

async function renderPdf(receipt: ReceiptRow, ctx: Awaited<ReturnType<typeof loadReceiptContext>>) {
  const description =
    ctx.order.purpose === "one_off"
      ? "Payment"
      : `${ctx.plan?.name ?? "Subscription"} (${ctx.order.purpose === "renewal" ? "renewal" : "subscription"})`;
  return buildReceiptPdf({
    businessName: siteConfig.name,
    supportEmail: siteConfig.supportEmail,
    receiptNumber: receipt.number,
    issuedAt: new Date(ctx.order.paid_at ?? receipt.created_at),
    customerName: ctx.profile?.full_name ?? null,
    customerEmail: ctx.profile?.email ?? null,
    description,
    period: ctx.sub
      ? `${dateFmt.format(new Date(ctx.sub.current_period_start))} to ${dateFmt.format(new Date(ctx.sub.current_period_end))}`
      : undefined,
    amountKes: ctx.order.amount_kes,
    mpesaReceipt: ctx.tx?.mpesa_receipt ?? null,
    phoneMasked: ctx.tx?.phone && /^254\d{9}$/.test(ctx.tx.phone) ? maskPhone(ctx.tx.phone) : null,
    accountRef: ctx.order.account_ref,
  });
}

/** Build/store PDFs and send receipt notifications that haven't gone out yet. */
export async function fulfilReceipts(opts: { limit?: number } = {}): Promise<{ processed: number; errors: number }> {
  const db = createAdminClient();
  const notifier = getNotifier();
  const { data: receipts, error } = await db
    .from("receipts")
    .select("id, number, created_at, pdf_path, emailed_at, sms_at, order_id")
    .gte("created_at", new Date(Date.now() - SWEEP_WINDOW_MS).toISOString())
    .or(
      ["pdf_path.is.null", notifier.email ? "emailed_at.is.null" : null, notifier.sms ? "sms_at.is.null" : null]
        .filter(Boolean)
        .join(","),
    )
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 10);
  if (error) throw new Error(`fulfilReceipts: ${error.message}`);

  let errors = 0;
  for (const receipt of receipts) {
    try {
      const path = await ensureReceiptPdf(receipt);
      const needsEmail = notifier.email && !receipt.emailed_at;
      const needsSms = notifier.sms && !receipt.sms_at;
      if (!needsEmail && !needsSms) continue;

      const ctx = await loadReceiptContext(receipt);
      const attachment = needsEmail ? (await db.storage.from(BUCKET).download(path)).data : null;
      const message = paymentReceived({
        product: siteConfig.name,
        amountKes: ctx.order.amount_kes,
        receiptNumber: receipt.number,
        mpesaReceipt: ctx.tx?.mpesa_receipt,
      });
      const report = await notifyRecipient(
        {
          email: needsEmail ? ctx.profile?.email : null,
          phone: needsSms ? (ctx.profile?.phone ?? ctx.tx?.phone) : null,
        },
        {
          ...message,
          attachments: attachment
            ? [{ filename: `${receipt.number}.pdf`, content: new Uint8Array(await attachment.arrayBuffer()) }]
            : undefined,
        },
        { ...notifier, telegram: null },
      );
      const now = new Date().toISOString();
      await db
        .from("receipts")
        .update({
          ...(report.email?.ok || (needsEmail && !ctx.profile?.email) ? { emailed_at: now } : {}),
          ...(report.sms?.ok || (needsSms && !ctx.profile?.phone && !ctx.tx?.phone) ? { sms_at: now } : {}),
        })
        .eq("id", receipt.id);
    } catch (e) {
      errors++;
      console.error("[receipts] fulfilment failed for", receipt.number, e);
    }
  }
  return { processed: receipts.length, errors };
}

/** A short-lived download link for one receipt PDF (generated on demand if missing). */
export async function receiptDownloadUrl(receiptId: string): Promise<string> {
  const db = createAdminClient();
  const { data: receipt, error } = await db
    .from("receipts")
    .select("id, number, created_at, pdf_path, emailed_at, sms_at, order_id")
    .eq("id", receiptId)
    .single();
  if (error || !receipt) throw new Error("receipt not found");
  const path = await ensureReceiptPdf(receipt);
  const { data, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, 60, { download: `${receipt.number}.pdf` });
  if (signError || !data) throw new Error(`could not sign receipt URL: ${signError?.message}`);
  return data.signedUrl;
}
