import Link from "next/link";
import { siteConfig } from "@/config/site";
import { Button } from "@/components/ui/button";

// Placeholder landing copy. Final copy lands in Milestone 5.
const highlights = [
  { title: "Pay with M-Pesa", body: "STK push checkout with a clear “check your phone” flow and live status." },
  {
    title: "Never miss a payment",
    body: "Callbacks are logged first and confirmed with Daraja, so nothing slips through.",
  },
  { title: "Simple renewals", body: "Reminders by SMS, email and Telegram before your plan renews." },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center sm:py-28">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{siteConfig.name}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">{siteConfig.description}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/login">Get started</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-6 pb-24 sm:grid-cols-3">
        {highlights.map((h) => (
          <div key={h.title} className="rounded-xl border p-6">
            <h2 className="font-semibold">{h.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{h.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
