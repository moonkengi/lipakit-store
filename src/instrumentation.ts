/**
 * Runs once when the Next.js server starts. We use it to validate the server
 * environment up front, so a missing secret fails the boot instead of a
 * customer's payment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@/lib/env");
    getServerEnv();
  }
}
