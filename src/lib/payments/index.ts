/**
 * App wiring for payments: turns env vars into an M-Pesa client and a
 * Supabase-backed settlement store. Route handlers and cron jobs import from
 * here; the framework-agnostic logic lives in lib/mpesa and lib/reconcile.
 */
export { callbackUrl, getMpesaClient, mpesaConfigFromEnv, type CallbackKind } from "./mpesa-client";
export { createSupabaseStkStore } from "./supabase-store";
export { CheckoutError, startStkCheckout, type StartCheckoutResult } from "./checkout";
