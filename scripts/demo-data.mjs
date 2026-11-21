#!/usr/bin/env node
/**
 * pnpm demo:data: fill a development project with realistic demo data, so the
 * dashboard and admin panel have something to show:
 *   - an admin (admin@demo.example.com) and three customers
 *   - an active paid subscription with a receipt, a trial, and one in grace
 *   - an unmatched Paybill payment and an order needing review
 *
 * Uses the same database functions as real payments. Refuses to run unless
 * MPESA_MODE=simulator, so it can't touch a live project by accident.
 * Sign in as the demo users with a magic link (Supabase → Authentication → Users → Send magic link).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

if ((env.MPESA_MODE ?? "simulator") !== "simulator") {
  console.error("Refusing: demo data is only for projects running with MPESA_MODE=simulator.");
  process.exit(1);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local) first.");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const day = 86_400_000;
const ref = () => `LK${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function user(email, fullName, phone, role = "user") {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  let u = list?.users.find((x) => x.email === email);
  if (!u)
    u = must(
      await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } }),
      `create ${email}`,
    ).user;
  must(await db.from("profiles").update({ full_name: fullName, phone, role }).eq("id", u.id), `profile ${email}`);
  return u.id;
}

async function plan(code) {
  return must(await db.from("plans").select("id, price_kes").eq("code", code).single(), `plan ${code}`);
}

async function paidViaPaybill(userId, p, purpose = "subscription") {
  const accountRef = ref();
  const order = must(
    await db
      .from("orders")
      .insert({ user_id: userId, purpose, plan_id: p.id, amount_kes: p.price_kes, account_ref: accountRef })
      .select("id")
      .single(),
    "order",
  );
  must(
    await db.rpc("mpesa_settle_c2b", {
      p_trans_id: `DEMO${randomUUID().slice(0, 6).toUpperCase()}`,
      p_amount: p.price_kes,
      p_account_ref: accountRef,
      p_phone: "254712345678",
      p_trans_time: new Date().toISOString(),
      p_raw: { demo: true },
      p_order_id: order.id,
      p_order_status: "paid",
      p_order_reason: "Demo payment",
    }),
    "settle",
  );
}

const pro = await plan("pro_monthly");
const starter = await plan("starter_monthly");

await user("admin@demo.example.com", "Demo Admin", "254700000001", "admin");
const wanjiku = await user("wanjiku@demo.example.com", "Wanjiku Kamau", "254712345678");
const otieno = await user("otieno@demo.example.com", "Otieno Odhiambo", "254722334455");
const amina = await user("amina@demo.example.com", "Amina Hassan", "254733445566");

const { count } = await db
  .from("subscriptions")
  .select("id", { count: "exact", head: true })
  .in("user_id", [wanjiku, otieno, amina]);
if ((count ?? 0) > 0) {
  console.log("Demo customers already have subscriptions; leaving them as they are.");
} else {
  await paidViaPaybill(wanjiku, pro); // active Pro, with a receipt
  const now = Date.now();
  must(
    await db.from("subscriptions").insert({
      user_id: otieno,
      plan_id: starter.id,
      status: "trialing",
      current_period_start: new Date(now - 5 * day).toISOString(),
      current_period_end: new Date(now + 2 * day).toISOString(),
    }),
    "trial",
  );
  must(
    await db.from("subscriptions").insert({
      user_id: amina,
      plan_id: pro.id,
      status: "grace",
      current_period_start: new Date(now - 31 * day).toISOString(),
      current_period_end: new Date(now - day).toISOString(),
      grace_until: new Date(now + 2 * day).toISOString(),
    }),
    "grace",
  );
  // A Paybill payment with a mistyped account number, and an underpaid order.
  must(
    await db.rpc("mpesa_settle_c2b", {
      p_trans_id: `DEMO${randomUUID().slice(0, 6).toUpperCase()}`,
      p_amount: 1500,
      p_account_ref: "LKTYP0",
      p_phone: "254733445566",
      p_trans_time: new Date().toISOString(),
      p_raw: { demo: true },
    }),
    "unmatched",
  );
  must(
    await db.from("orders").insert({
      user_id: amina,
      purpose: "renewal",
      plan_id: pro.id,
      amount_kes: 1500,
      account_ref: ref(),
      status: "needs_review",
      status_reason: "Amount mismatch: expected KES 1500, received KES 1000.",
      paid_at: new Date().toISOString(),
    }),
    "review",
  );
}

console.log("Demo data ready. Admin: admin@demo.example.com. Customers: wanjiku@, otieno@, amina@demo.example.com");
