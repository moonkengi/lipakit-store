import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Privacy Policy" };

// PLACEHOLDER. Kenya's Data Protection Act 2019 applies; get it reviewed before launch.
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground">
        Placeholder text. Replace this page with the privacy policy for {siteConfig.name}. Explain what you collect
        (email, phone number, M-Pesa transaction details), why, how long you keep it, and how users can ask for it to be
        deleted.
      </p>
    </article>
  );
}
