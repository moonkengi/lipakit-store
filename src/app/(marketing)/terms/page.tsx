import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Terms and refunds" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 px-4 py-16 text-sm leading-6">
      <h1 className="text-3xl font-bold tracking-tight">Terms and refunds</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What you&apos;re buying</h2>
        <p>
          {siteConfig.name} is downloadable source code: a starter kit for software that takes M-Pesa payments. You buy
          a licence to use it, in the tier you choose (Lite, Solo or Agency). Prices are in Kenyan shillings and paid
          once by M-Pesa.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pre-orders and delivery</h2>
        <p>
          {siteConfig.name} is currently sold as a pre-order. You get a receipt by email when you pay. We email you the
          release date within 7 days of your order, and deliver version 1.0 by email as a download with your personal
          licence.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Refunds</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Before delivery: cancel a pre-order any time for a full refund.</li>
          <li>
            After delivery: because source code can&apos;t be returned, refunds are given only if the kit doesn&apos;t work as
            described and we can&apos;t fix it within 14 days of you reporting the problem.
          </li>
          <li>Refunds go back to the M-Pesa number you paid with, within 7 working days of approval.</li>
        </ul>
        <p>
          To ask for a refund, email{" "}
          <a className="underline" href={`mailto:${siteConfig.supportEmail}`}>
            {siteConfig.supportEmail}
          </a>{" "}
          with your receipt number.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Licence</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            You may use the code in your own products (Lite: one; Solo: unlimited) or, with Agency, in products for
            clients, including white-label.
          </li>
          <li>
            You may not resell, share or publish the kit itself, or anything derived from it, as a kit, template or
            library.
          </li>
          <li>The full licence comes with the download and takes precedence over this summary.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your responsibilities</h2>
        <p>
          You are responsible for testing and running your own payment system, and for your own Safaricom, Paystack and
          hosting accounts. {siteConfig.name} is provided without warranty, and our liability is limited to the price
          you paid.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Law and contact</h2>
        <p>
          These terms are governed by the laws of Kenya. Questions:{" "}
          <a className="underline" href={`mailto:${siteConfig.supportEmail}`}>
            {siteConfig.supportEmail}
          </a>
          . Nairobi, Kenya.
        </p>
      </section>
    </article>
  );
}
