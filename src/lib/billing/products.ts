/**
 * One-time products (pre-orders, e-books, courses, setup fees): sold once with
 * an M-Pesa payment, no subscription. A paid order gets a numbered receipt.
 * Check ownership with hasPurchased() from ./access.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Product = Tables<"products">;

/** Active products in display order. Readable by anyone (RLS: "products: anyone reads active products"). */
export async function getActiveProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Could not load products: ${error.message}`);
  return data;
}
