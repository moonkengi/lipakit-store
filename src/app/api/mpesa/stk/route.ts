/**
 * Start an STK push for the signed-in user.
 *
 * POST { planCode: string, phone: string }
 * → 200 { orderId, accountRef, checkoutRequestId, customerMessage }
 * → 400 invalid input · 401 not signed in · 404 unknown plan · 429 too many pending · 502 M-Pesa error
 *
 * The amount always comes from the database, never from the client.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { CheckoutError, startStkCheckout } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

const code = z.string().regex(/^[a-z0-9_]+$/);
const bodySchema = z.union([
  z.object({ planCode: code, phone: z.string().min(9).max(20) }),
  z.object({ productCode: code, phone: z.string().min(9).max(20) }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Choose what to buy and enter your phone number." }, { status: 400 });

  const supabase = await createClient();
  let order: Pick<
    Parameters<typeof startStkCheckout>[0],
    "amountKes" | "purpose" | "planId" | "productId" | "subscriptionId"
  >;

  if ("productCode" in parsed.data) {
    // One-time product: no subscription involved.
    const { data: product } = await supabase
      .from("products")
      .select("id, price_kes")
      .eq("code", parsed.data.productCode)
      .eq("is_active", true)
      .maybeSingle();
    if (!product) return NextResponse.json({ error: "That product isn't available." }, { status: 404 });
    order = { amountKes: product.price_kes, purpose: "one_off", productId: product.id };
  } else {
    const { data: plan } = await supabase
      .from("plans")
      .select("id, price_kes")
      .eq("code", parsed.data.planCode)
      .eq("is_active", true)
      .maybeSingle();
    if (!plan) return NextResponse.json({ error: "That plan isn't available." }, { status: 404 });

    // Already on a live plan? Then this payment renews it (from the current period end).
    const { data: live } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["trialing", "active", "grace"])
      .maybeSingle();
    order = {
      amountKes: plan.price_kes,
      purpose: live ? "renewal" : "subscription",
      planId: plan.id,
      subscriptionId: live?.id,
    };
  }

  try {
    const result = await startStkCheckout({
      userId: user.id,
      email: user.email,
      phone: parsed.data.phone,
      ...order,
    });
    // Remember the number for next time (users may edit their own phone; see RLS migration).
    if (user.phone !== result.phone) {
      await supabase.from("profiles").update({ phone: result.phone }).eq("id", user.id);
    }
    return NextResponse.json({
      orderId: result.orderId,
      accountRef: result.accountRef,
      checkoutRequestId: result.checkoutRequestId,
      customerMessage: result.customerMessage,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error("[api/mpesa/stk] unexpected error", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
