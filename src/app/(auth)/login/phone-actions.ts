"use server";

import { redirect } from "next/navigation";
import { features } from "@/config/features";
import { formatPhone, MpesaError, normalizePhone } from "@/lib/mpesa";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type PhoneState =
  { step: "phone"; error?: string } | { step: "code"; phone: string; display: string; error?: string };

export async function sendPhoneCode(_: PhoneState, form: FormData): Promise<PhoneState> {
  if (!features.phoneOtp) return { step: "phone", error: "Phone sign-in is turned off." };
  let phone: string;
  try {
    phone = normalizePhone(String(form.get("phone") ?? ""));
  } catch (e) {
    return { step: "phone", error: e instanceof MpesaError ? e.message : "Enter a Kenyan mobile number." };
  }
  const { error } = await (await createClient()).auth.signInWithOtp({ phone: `+${phone}` });
  if (error) {
    console.error("[auth] phone OTP failed:", error.message);
    return { step: "phone", error: "We couldn't send a code. Wait a minute and try again." };
  }
  return { step: "code", phone, display: formatPhone(phone) };
}

export async function verifyPhoneCode(_: PhoneState, form: FormData): Promise<PhoneState> {
  const phone = String(form.get("phone") ?? "");
  const code = String(form.get("code") ?? "").trim();
  const { error } = await (await createClient()).auth.verifyOtp({ phone: `+${phone}`, token: code, type: "sms" });
  if (error) return { step: "code", phone, display: formatPhone(phone), error: "That code is wrong or has expired." };
  redirect(safeNextPath(String(form.get("next") ?? "")));
}
