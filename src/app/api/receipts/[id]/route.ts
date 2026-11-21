/**
 * Download a receipt PDF. RLS decides who may see the receipt (its owner or an
 * admin); the file itself is served through a 60-second signed URL.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { receiptDownloadUrl } from "@/lib/billing/fulfil";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, ctx: RouteContext<"/api/receipts/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: receipt } = await supabase.from("receipts").select("id").eq("id", id).maybeSingle();
  if (!receipt) return new NextResponse(null, { status: 404 });

  try {
    return NextResponse.redirect(await receiptDownloadUrl(receipt.id));
  } catch (error) {
    console.error("[receipts] download failed", id, error);
    return NextResponse.json({ error: "We couldn't prepare this receipt. Please try again." }, { status: 500 });
  }
}
