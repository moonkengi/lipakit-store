import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Terms of Service" };

// PLACEHOLDER. Replace with terms reviewed by a lawyer before launch.
export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="text-muted-foreground">
        Placeholder text. Replace this page with the terms for {siteConfig.name} before you launch. Cover subscriptions
        and renewals, refunds, acceptable use, and how M-Pesa payments are handled.
      </p>
    </article>
  );
}
