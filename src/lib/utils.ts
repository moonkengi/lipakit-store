import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes, letting later classes win (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer shillings for display, e.g. 1500 → "KES 1,500". */
export function formatKes(amount: number): string {
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount)}`;
}
