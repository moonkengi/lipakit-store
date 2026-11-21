"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { BillingError, requestRatiba, setCancelAtPeriodEnd, startTrial, stopRatiba } from "@/lib/billing/subscriptions";

export type ActionState = { ok: boolean; message: string } | null;

/** Every action re-checks the session itself; never trust that the page did. */
async function run(fn: (userId: string) => Promise<string>): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/billing");
  try {
    const message = await fn(user.id);
    refresh();
    return { ok: true, message };
  } catch (error) {
    if (error instanceof BillingError) return { ok: false, message: error.message };
    console.error("[billing action]", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function cancelAtPeriodEndAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const cancel = formData.get("cancel") === "true";
  return run(async (userId) => {
    await setCancelAtPeriodEnd(userId, cancel);
    return cancel ? "Your plan will end at the end of this period." : "Your plan will continue.";
  });
}

export async function enableRatibaAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const phone = z.string().min(9).max(20).safeParse(formData.get("phone"));
  if (!phone.success) return { ok: false, message: "Enter your M-Pesa phone number." };
  return run(async (userId) => {
    await requestRatiba(userId, phone.data);
    return "Check your phone and approve the M-Pesa standing order.";
  });
}

export async function disableRatibaAction(): Promise<ActionState> {
  return run(async (userId) => {
    await stopRatiba(userId);
    return "Automatic renewal is off. Also remove the standing order on your phone: dial *334# → M-PESA Ratiba.";
  });
}

export async function startTrialAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/pricing");
  const planCode = String(formData.get("planCode") ?? "");
  try {
    await startTrial(user.id, planCode);
  } catch (error) {
    const message = error instanceof BillingError ? error.message : "We couldn't start your trial.";
    redirect(`/dashboard/checkout?plan=${encodeURIComponent(planCode)}&error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/billing");
}
