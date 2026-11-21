import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 px-4 py-16 text-sm leading-6">
      <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
      <p>
        This explains what {siteConfig.name} collects when you buy from this site, and why. We follow Kenya&apos;s Data
        Protection Act, 2019.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your email address, to sign you in and send receipts and your download.</li>
          <li>The M-Pesa number you pay with, and the payment record (amount, date, M-Pesa reference).</li>
          <li>Your name, if you add it.</li>
        </ul>
        <p>We don&apos;t sell your data or use it for advertising.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Who processes it for us</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase (database and sign-in)</li>
          <li>Paystack and Safaricom M-Pesa (payments)</li>
          <li>Netlify (hosting)</li>
          <li>
            PostHog, EU region (site analytics: pages visited and anonymised session recordings, with everything you
            type hidden)
          </li>
          <li>Our email and SMS providers (receipts and messages)</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How long we keep it</h2>
        <p>
          Payment and receipt records are kept as long as the law requires for tax and accounting. You can ask us to
          delete the rest of your data at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your rights</h2>
        <p>
          You can ask to see, correct or delete your data: email{" "}
          <a className="underline" href={`mailto:${siteConfig.supportEmail}`}>
            {siteConfig.supportEmail}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
