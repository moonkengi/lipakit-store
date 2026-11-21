/**
 * Environment variables, validated with Zod.
 *
 * Two entry points:
 * - `publicEnv`: NEXT_PUBLIC_* values. Safe in client bundles.
 * - `getServerEnv()`: everything else. Server only; importing this file from
 *   a client component still works, but calling `getServerEnv()` there throws.
 *
 * Server env is parsed lazily (first call) and memoised. `src/instrumentation.ts`
 * calls it once on server start so a bad config fails at boot, not mid-payment.
 */
import { z } from "zod";
import { findBannedKeyword } from "@/lib/mpesa/c2b";

/** Treat empty strings in .env files as "not set". */
const optional = () =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().transform((v) => v.replace(/\/+$/, "")),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Web push (optional): the public half of your VAPID key pair. */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optional(),
});

export const mpesaModes = ["simulator", "sandbox", "production"] as const;
export type MpesaMode = (typeof mpesaModes)[number];

export const serverSchema = publicSchema
  .extend({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    // --- M-Pesa (Daraja) ---
    MPESA_MODE: z.enum(mpesaModes).default("simulator"),
    MPESA_CONSUMER_KEY: optional(),
    MPESA_CONSUMER_SECRET: optional(),
    MPESA_SHORTCODE: optional(),
    MPESA_PASSKEY: optional(),
    MPESA_TILL_OR_PAYBILL: z.enum(["paybill", "till"]).default("paybill"),
    /** Buy Goods only: the till number (PartyB), when it differs from MPESA_SHORTCODE (the store number). */
    MPESA_TILL_NUMBER: optional(),
    /** Secret path segment in callback URLs. Long and random; see .env.example. */
    MPESA_CALLBACK_TOKEN: z
      .string()
      .min(24, "MPESA_CALLBACK_TOKEN must be at least 24 characters")
      .regex(/^[A-Za-z0-9_-]+$/, "MPESA_CALLBACK_TOKEN may only use letters, digits, - and _ (it goes in a URL)")
      .refine((v) => !findBannedKeyword(v), {
        message: "MPESA_CALLBACK_TOKEN contains a word Safaricom blocks in callback URLs; generate another",
      }),
    /**
     * Who sends the STK push. "daraja": your own Paybill/Till through Safaricom.
     * "paystack": Paystack's shortcode, for when you don't have one yet (no C2B, Ratiba or B2C).
     * Ignored in simulator mode.
     */
    PAYMENT_PROVIDER: z.enum(["daraja", "paystack"]).default("daraja"),
    /** Paystack secret key (sk_test_... or sk_live_...). Server only. */
    PAYSTACK_SECRET_KEY: optional(),
    /** C2B validation: accept every payment, or reject unknown account numbers (needs validation enabled by Safaricom). */
    MPESA_C2B_VALIDATION: z.enum(["accept", "match"]).default("accept"),
    /** Offer M-Pesa Ratiba (standing orders) as auto-renew. Needs Ratiba approval from Safaricom in production. */
    MPESA_RATIBA_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** B2C shortcode (PartyA for payouts). Defaults to MPESA_SHORTCODE. */
    MPESA_B2C_SHORTCODE: optional(),
    MPESA_B2C_INITIATOR: optional(),
    MPESA_B2C_SECURITY_CREDENTIAL: optional(),

    // --- Africa's Talking (SMS) ---
    AT_USERNAME: optional(),
    AT_API_KEY: optional(),
    AT_SENDER_ID: optional(),

    // --- Resend (email) ---
    RESEND_API_KEY: optional(),
    EMAIL_FROM: optional(),

    // --- Telegram ---
    TELEGRAM_BOT_TOKEN: optional(),
    /** The bot's @username without the @, for "Link Telegram" deep links. */
    TELEGRAM_BOT_USERNAME: optional(),
    /** Telegram echoes this in a header on every webhook call. 1-256 chars: letters, digits, _ and -. */
    TELEGRAM_WEBHOOK_SECRET: optional().refine((v) => v === undefined || /^[A-Za-z0-9_-]{16,256}$/.test(v), {
      message: "TELEGRAM_WEBHOOK_SECRET must be 16-256 characters: letters, digits, _ and -",
    }),
    /** Comma-separated chat IDs, e.g. "12345,-100987". */
    TELEGRAM_ADMIN_CHAT_IDS: optional().transform((v) =>
      v
        ? v
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    ),

    /** Phone sign-in: the Send SMS hook secret from Supabase (format v1,whsec_...). */
    SUPABASE_SMS_HOOK_SECRET: optional(),

    // --- Admin alert channels (all optional) ---
    SLACK_WEBHOOK_URL: optional().pipe(z.url().startsWith("https://").optional()),
    DISCORD_WEBHOOK_URL: optional().pipe(z.url().startsWith("https://").optional()),
    /** Generic webhook: every event as signed JSON. */
    ALERT_WEBHOOK_URL: optional().pipe(z.url().optional()),
    ALERT_WEBHOOK_SECRET: optional(),

    // --- Web push (optional) ---
    VAPID_PRIVATE_KEY: optional(),
    /** Contact for push services, e.g. mailto:you@example.com */
    VAPID_SUBJECT: optional(),

    // --- B2C payouts (Pro) ---
    /** Most KES all payouts together may send per day (Nairobi time). A safety brake, not a Safaricom limit. */
    B2C_DAILY_LIMIT_KES: z.coerce.number().int().min(0).default(50_000),

    // --- Jobs and billing ---
    CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),
    GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(3),

    /** Your LipaKit licence key (from .lipakit-license). Only displayed on the Health page. */
    LIPAKIT_LICENSE_KEY: optional(),

    // Set by Vercel automatically ("production" | "preview" | "development"). Not something you configure.
    VERCEL_ENV: optional(),
    // Set by Netlify automatically ("production" | "deploy-preview" | "branch-deploy" | "dev").
    CONTEXT: optional(),
  })
  .superRefine((env, ctx) => {
    if (env.VAPID_PRIVATE_KEY && !env.VAPID_SUBJECT) {
      ctx.addIssue({
        code: "custom",
        path: ["VAPID_SUBJECT"],
        message: "VAPID_SUBJECT is required with web push keys (e.g. mailto:you@example.com)",
      });
    }
    // The simulator fakes payments; it must never run on a live production deployment.
    if (env.MPESA_MODE === "simulator" && (env.VERCEL_ENV === "production" || env.CONTEXT === "production")) {
      ctx.addIssue({
        code: "custom",
        path: ["MPESA_MODE"],
        message: "MPESA_MODE=simulator is not allowed on a production deployment",
      });
    }
    // Paystack needs its secret key, and can't do Ratiba.
    if (env.MPESA_MODE !== "simulator" && env.PAYMENT_PROVIDER === "paystack") {
      if (!env.PAYSTACK_SECRET_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["PAYSTACK_SECRET_KEY"],
          message: "PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack",
        });
      }
      if (env.MPESA_RATIBA_ENABLED) {
        ctx.addIssue({
          code: "custom",
          path: ["MPESA_RATIBA_ENABLED"],
          message: "Ratiba needs your own Daraja shortcode; turn it off with PAYMENT_PROVIDER=paystack",
        });
      }
    }
    // Real Daraja modes need real credentials. The simulator needs none.
    if (env.MPESA_MODE !== "simulator" && env.PAYMENT_PROVIDER === "daraja") {
      for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when MPESA_MODE=${env.MPESA_MODE}`,
          });
        }
      }
    }
    // Pairs that only make sense together.
    const pairs = [
      ["AT_USERNAME", "AT_API_KEY"],
      ["RESEND_API_KEY", "EMAIL_FROM"],
      ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
      ["ALERT_WEBHOOK_URL", "ALERT_WEBHOOK_SECRET"],
      ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
      ["MPESA_B2C_INITIATOR", "MPESA_B2C_SECURITY_CREDENTIAL"],
    ] as const;
    for (const [a, b] of pairs) {
      if (Boolean(env[a]) !== Boolean(env[b])) {
        ctx.addIssue({
          code: "custom",
          path: [env[a] ? b : a],
          message: `${a} and ${b} must be set together`,
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

/** Turn a ZodError into a readable multi-line message. */
function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Netlify's Supabase extension names the anon key SUPABASE_ANON_KEY (see next.config.ts).
  const result = serverSchema.safeParse({
    ...source,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY || source.SUPABASE_ANON_KEY,
  });
  if (!result.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid public environment variables:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline
 * them into client bundles. Do not replace this with `process.env` spread.
 */
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});

let cachedServerEnv: ServerEnv | undefined;

/** Validated server env. Throws if called in the browser or if config is invalid. */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() was called in the browser. Server env must never reach the client.");
  }
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}
