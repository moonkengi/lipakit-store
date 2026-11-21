import Link from "next/link";
import { Bell, FlaskConical, LayoutDashboard, RefreshCcw, ShieldCheck, Smartphone } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Button } from "@/components/ui/button";

/* LipaKit store landing page (store branch only; the kit ships a generic template). */

const problems = [
  "Callbacks that arrive late, twice, or never",
  "Customers who paid while your app thinks they didn't",
  "Monthly billing on a network built for one-off payments",
  "Failures the Daraja sandbox can't even produce",
];

const features = [
  {
    icon: Smartphone,
    title: "M-Pesa payments",
    body: "STK push confirmed with M-Pesa before it counts. Paybill and Till payments matched to orders. Payouts (B2C).",
  },
  {
    icon: RefreshCcw,
    title: "Subscriptions",
    body: "Plans, free trials, reminders by SMS and email, grace periods, automatic renewal with M-Pesa Ratiba, PDF receipts.",
  },
  {
    icon: LayoutDashboard,
    title: "Admin panel",
    body: "Revenue, orders, customers, unmatched payments, a review queue, the callback log with replay, health checks.",
  },
  {
    icon: FlaskConical,
    title: "M-Pesa simulator",
    body: "Every outcome on your laptop: cancelled, wrong PIN, timeout, insufficient funds, duplicate, late and missing callbacks.",
  },
  {
    icon: Bell,
    title: "Alerts",
    body: "Hear about failed callbacks and stuck payments on Telegram, Slack, Discord, a signed webhook or web push.",
  },
  {
    icon: ShieldCheck,
    title: "Tested where it matters",
    body: "Every payment path has a test, and the docs explain the real-world failure behind each one.",
  },
];

const faqs = [
  {
    q: "What exactly do I get?",
    a: "The full source code (Next.js, TypeScript, Supabase), the docs, and your licence. You host it on your own Supabase and hosting accounts. Payments go to your own Paybill or Till, or through Paystack until you have one.",
  },
  {
    q: "Is this a pre-order?",
    a: "Yes. You pay now at the launch price and get version 1.0 by email as a download with your licence. We'll email you the release date within 7 days of your order, and you can cancel for a full refund any time before delivery.",
  },
  {
    q: "Do I need a Paybill or Till?",
    a: "Not to start. You build and test with the built-in simulator and Safaricom's sandbox. To take real money you need your own shortcode, or you can use Paystack in the meantime.",
  },
  {
    q: "Does LipaKit handle my customers' money?",
    a: "No. It's code that runs on your accounts. Payments go straight from your customers to you.",
  },
  {
    q: "What if the kit doesn't work for me?",
    a: "Report the problem and we'll fix it. If we can't within 14 days, you get a full refund. See the terms.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center sm:py-28">
        <p className="text-sm font-medium text-primary">Pre-order now · Next.js + Supabase</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          M-Pesa payments for your SaaS, done right
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          {siteConfig.name} is a starter kit for software products that customers pay for with M-Pesa. Checkout,
          subscriptions, receipts and an admin panel, with every failure case handled.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/pricing">See pricing</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="#faq">Questions</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-3xl pb-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Sending an STK push is the easy part</h2>
        <p className="mt-3 text-center text-muted-foreground">The hard part is everything after it:</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {problems.map((p) => (
            <li key={p} className="rounded-xl border p-4 text-sm">
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-muted-foreground">{siteConfig.name} handles all of it, out of the box.</p>
      </section>

      <section className="grid gap-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border p-6">
            <f.icon className="size-6 text-primary" aria-hidden />
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="pb-20 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">One-time payment, by M-Pesa</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Lite KES 6,400 · Solo KES 12,900 · Agency KES 38,900. Updates after the included period are optional, and the
          code keeps working forever either way.
        </p>
        <Button size="lg" className="mt-6" asChild>
          <Link href="/pricing">Choose your licence</Link>
        </Button>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Questions</h2>
        <dl className="mt-8 divide-y rounded-xl border">
          {faqs.map((f) => (
            <div key={f.q} className="p-6">
              <dt className="font-medium">{f.q}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Something else? Email{" "}
          <a className="underline" href={`mailto:${siteConfig.supportEmail}`}>
            {siteConfig.supportEmail}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
