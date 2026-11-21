import Link from "next/link";
import { CalendarClock, ReceiptText, ShieldCheck, Smartphone } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Button } from "@/components/ui/button";

/*
 * Landing page template. The copy describes what every M-Pesa SaaS built on
 * this kit offers its customers; replace the product-specific parts (headline,
 * features) with your own. Name and tagline come from src/config/site.ts.
 */

const features = [
  {
    icon: Smartphone,
    title: "Pay with M-Pesa in seconds",
    body: "Enter your number, approve the prompt on your phone, done. No card, no forms.",
  },
  {
    icon: CalendarClock,
    title: "Renewals on your terms",
    body: "We remind you before your plan renews. Or turn on automatic renewal with an M-Pesa standing order.",
  },
  {
    icon: ReceiptText,
    title: "A receipt for every payment",
    body: "PDF receipts by email and SMS, and your full payment history in your dashboard.",
  },
  {
    icon: ShieldCheck,
    title: "Payments you can trust",
    body: "Every payment is confirmed with M-Pesa before it counts, so you're never charged twice or left waiting.",
  },
];

const steps = [
  { title: "Choose a plan", body: "Start with a free trial where there is one." },
  { title: "Approve on your phone", body: "An M-Pesa prompt arrives. Enter your PIN." },
  { title: "You're in", body: "Access starts the moment M-Pesa confirms." },
];

const faqs = [
  {
    q: "Do I need a card?",
    a: "No. You pay with M-Pesa from your phone. You can also pay from the M-Pesa menu using our Paybill and the account number we send you.",
  },
  {
    q: "What happens when my plan is due?",
    a: "We remind you three days before by SMS and email. If you pay early you don't lose any days, because your new period starts when the current one ends.",
  },
  {
    q: "What if I miss a payment?",
    a: "You keep access for a few days' grace while you pay. After that the plan pauses until you renew.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, anytime from your billing page. Your plan stays active until the end of the period you paid for.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center sm:py-28">
        <p className="text-sm font-medium text-primary">Pay with M-Pesa</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{siteConfig.name}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">{siteConfig.description}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/pricing">See plans</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border p-6">
            <f.icon className="size-6 text-primary" aria-hidden />
            <h2 className="mt-4 font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="pb-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl bg-muted/50 p-6">
              <span className="text-sm font-semibold text-primary">Step {i + 1}</span>
              <p className="mt-2 font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-3xl pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Questions</h2>
        <dl className="mt-8 divide-y rounded-xl border">
          {faqs.map((f) => (
            <div key={f.q} className="p-6">
              <dt className="font-medium">{f.q}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-10 text-center">
          <Button size="lg" asChild>
            <Link href="/pricing">Get started</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
