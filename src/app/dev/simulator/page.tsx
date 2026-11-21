import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getServerEnv } from "@/lib/env";
import { SimulatorPanel } from "./simulator-panel";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Dev-only page. Everything, including the heading, sits behind the mode check,
 * so outside simulator mode this renders the standard "not found" page.
 * (The real lock is /api/dev/simulate, which returns 404 outside simulator mode.)
 */
export default function SimulatorPage() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  // Decide per request, from the running server's env (not at build time).
  await connection();
  if (getServerEnv().MPESA_MODE !== "simulator") notFound();
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <title>M-Pesa simulator</title>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">M-Pesa simulator</h1>
        <p className="text-sm text-muted-foreground">
          Pick what the next STK push should do, then pay from the checkout page. Only available when{" "}
          <code>MPESA_MODE=simulator</code>.
        </p>
      </div>
      <SimulatorPanel />
    </main>
  );
}
