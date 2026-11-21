/**
 * Runs once when the Next.js server starts.
 *
 * 1. Validates the server environment up front, so a missing secret fails the
 *    boot instead of a customer's payment.
 * 2. In simulator mode, stands in for Vercel Cron by calling the status poller
 *    every 20 seconds, so "missing callback" scenarios resolve on your laptop.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getServerEnv } = await import("@/lib/env");
  const env = getServerEnv();

  if (env.MPESA_MODE === "simulator") {
    const url = `${env.NEXT_PUBLIC_SITE_URL}/api/cron/mpesa-poll`;
    const timer = setInterval(() => {
      fetch(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }).catch(() => {
        // Server still starting, or stopped. The next tick will try again.
      });
    }, 20_000);
    timer.unref();
  }
}
