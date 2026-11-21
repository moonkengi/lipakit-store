import { describe, expect, it, vi } from "vitest";
import { discordChannel, slackChannel, telegramChannel } from "@/lib/alerts/channels";
import { signPayload, verifyWebhookSignature, webhookChannel } from "@/lib/alerts/webhook";
import { parseServerEnv } from "@/lib/env";
import { checkCount, checkJob, checkLastCallback, checkOldestPending } from "@/lib/health";
import { buildB2CRequest, parseB2CResult, parseB2CTimeout } from "@/lib/mpesa/b2c";
import { createDarajaClient } from "@/lib/mpesa/client";
import { createSimulatorClient, resetSimulator, updateSimulatorSettings } from "@/lib/mpesa/simulator";
import { generateLinkCode, hashLinkCode, parseStartCommand, telegramDeepLink } from "@/lib/telegram/linking";
import type { MpesaConfig } from "@/lib/mpesa";

vi.mock("@/lib/alerts", () => ({ configuredAlertChannels: () => [] }));
vi.mock("@/lib/notify", () => ({ getNotifier: () => ({}) }));
vi.mock("@/lib/notify/push", () => ({ pushEnabled: () => false }));

const event = {
  type: "payment.received" as const,
  title: "Payment received: KES 1,500",
  message: "STK payment for LKAB12CD34.",
  link: "https://app.co.ke/admin/orders",
};
const captured = () => {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe("alert channels", () => {
  it("Slack: text fallback plus a button to the admin page", async () => {
    const { fetch, calls } = captured();
    expect(await slackChannel("https://hooks.slack.com/x", fetch).send(event)).toEqual({ channel: "slack", ok: true });
    const body = calls[0].body as { text: string; blocks: { type: string }[] };
    expect(body.text).toContain("Payment received");
    expect(body.blocks.map((b) => b.type)).toEqual(["section", "actions"]);
  });

  it("Discord: an embed, with mentions disabled so content can't ping @everyone", async () => {
    const { fetch, calls } = captured();
    await discordChannel("https://discord.com/api/webhooks/x", fetch).send({ ...event, type: "callback.failed" });
    const body = calls[0].body as { allowed_mentions: { parse: string[] }; embeds: { color: number; url: string }[] };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({ color: 0xd93025, url: event.link });
  });

  it("Telegram: one message per admin chat; reports partial failure", async () => {
    let n = 0;
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(++n === 1 ? { ok: true } : { ok: false, description: "chat not found" })),
    ) as unknown as typeof globalThis.fetch;
    const res = await telegramChannel("token", ["1", "2"], fetch).send(event);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ channel: "telegram", ok: false, error: "chat not found" });
  });

  it("reports a failing channel instead of throwing", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    expect(await slackChannel("https://hooks.slack.com/x", fetch).send(event)).toEqual({
      channel: "slack",
      ok: false,
      error: "ECONNREFUSED",
    });
  });
});

describe("signed webhook", () => {
  it("signs the body, and the receiver-side helper verifies it", async () => {
    const { fetch, calls } = captured();
    await webhookChannel("https://example.com/hook", "s3cret", fetch).send(event);
    const raw = JSON.stringify(calls[0].body);
    const header = calls[0].headers["X-LipaKit-Signature"];
    expect(verifyWebhookSignature({ secret: "s3cret", body: raw, header })).toBe(true);
    expect(calls[0].body).toMatchObject({ type: "payment.received", data: {} });
  });

  it("rejects a tampered body, a wrong secret, and an old timestamp", () => {
    const now = 1_800_000_000_000;
    const t = Math.floor(now / 1000);
    const header = signPayload("s3cret", '{"a":1}', t);
    expect(verifyWebhookSignature({ secret: "s3cret", body: '{"a":1}', header, now })).toBe(true);
    expect(verifyWebhookSignature({ secret: "s3cret", body: '{"a":2}', header, now })).toBe(false);
    expect(verifyWebhookSignature({ secret: "other", body: '{"a":1}', header, now })).toBe(false);
    expect(verifyWebhookSignature({ secret: "s3cret", body: '{"a":1}', header, now: now + 301_000 })).toBe(false);
    expect(verifyWebhookSignature({ secret: "s3cret", body: '{"a":1}', header: null, now })).toBe(false);
  });
});

describe("Telegram linking", () => {
  it("parses /start with or without the bot name", () => {
    expect(parseStartCommand("/start ABCD2345EF")).toBe("ABCD2345EF");
    expect(parseStartCommand("/start@LipaKitBot abcd2345ef")).toBe("ABCD2345EF");
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("hello")).toBeNull();
    expect(parseStartCommand("/start AB")).toBeNull();
  });

  it("codes are unambiguous, and hashing is case-insensitive", () => {
    const code = generateLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(hashLinkCode(code.toLowerCase())).toBe(hashLinkCode(code));
    expect(hashLinkCode(code)).not.toContain(code);
    expect(telegramDeepLink("@LipaKitBot", "ABC")).toBe("https://t.me/LipaKitBot?start=ABC");
  });
});

describe("B2C", () => {
  const creds = { initiatorName: "apiop", securityCredential: "ENC==", shortcode: "600000" };
  const input = {
    originatorConversationId: "7b1c6f0e-1111-4c1d-9a55-2f3c4d5e6f70",
    phone: "0712345678",
    amountKes: 2500,
    command: "BusinessPayment" as const,
    remarks: "Refund LKAB12CD34",
    resultUrl: "https://app.co.ke/api/hooks/tok/b2c/result",
    timeoutUrl: "https://app.co.ke/api/hooks/tok/b2c/timeout",
  };

  it("builds a v3 request that carries our own OriginatorConversationID", () => {
    expect(buildB2CRequest(creds, input)).toMatchObject({
      OriginatorConversationID: input.originatorConversationId,
      InitiatorName: "apiop",
      CommandID: "BusinessPayment",
      Amount: "2500",
      PartyA: "600000",
      PartyB: "254712345678",
    });
  });

  it("posts to /mpesa/b2c/v3/paymentrequest", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/oauth/")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: "3599" }))
        : new Response(
            JSON.stringify({
              ConversationID: "AG_1",
              OriginatorConversationID: input.originatorConversationId,
              ResponseCode: "0",
            }),
          ),
    ) as unknown as typeof globalThis.fetch;
    const config = {
      mode: "sandbox",
      consumerKey: "k",
      consumerSecret: "s",
      shortcode: "174379",
      passkey: "p",
      transactionType: "CustomerPayBillOnline",
      partyB: "174379",
      b2c: creds,
    } satisfies MpesaConfig;
    const res = await createDarajaClient(config, { fetch }).b2cPayment(input);
    expect(res.conversationId).toBe("AG_1");
    expect(String((fetch as unknown as { mock: { calls: [string][] } }).mock.calls[1][0])).toBe(
      "https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest",
    );
  });

  it("parses success and failure results", () => {
    const ok = parseB2CResult({
      Result: {
        ResultType: 0,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        OriginatorConversationID: "o1",
        ConversationID: "c1",
        TransactionID: "NLJ41HAY6Q",
        ResultParameters: {
          ResultParameter: [
            { Key: "TransactionAmount", Value: 2500 },
            { Key: "ReceiverPartyPublicName", Value: "254712345678 - JANE DOE" },
          ],
        },
      },
    });
    expect(ok).toMatchObject({
      resultCode: 0,
      transactionId: "NLJ41HAY6Q",
      amountKes: 2500,
      receiverName: "254712345678 - JANE DOE",
    });
    const bad = parseB2CResult({
      Result: {
        ResultCode: 2001,
        ResultDesc: "The initiator information is invalid.",
        OriginatorConversationID: "o1",
        TransactionID: "0000000000",
      },
    });
    expect(bad).toMatchObject({ resultCode: 2001, transactionId: null });
  });

  it("finds the IDs in a timeout notice of any shape", () => {
    expect(parseB2CTimeout({ Result: { OriginatorConversationID: "o9", ConversationID: "c9" } })).toEqual({
      originatorConversationId: "o9",
      conversationId: "c9",
    });
  });

  it("simulator: success sends a result; timeout uses the timeout URL", async () => {
    resetSimulator();
    const sent: string[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      sent.push(String(url));
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;
    const jobs: (() => void)[] = [];
    const sim = createSimulatorClient({ fetch, schedule: (fn) => jobs.push(fn) });
    await sim.b2cPayment(input);
    updateSimulatorSettings({ nextOutcome: "timeout" });
    await sim.b2cPayment(input);
    jobs.forEach((j) => j());
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([input.resultUrl, input.timeoutUrl]);
  });
});

describe("health rules", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const min = (n: number) => new Date(now.getTime() - n * 60_000);

  it("flags a scheduler that never ran or stopped", () => {
    expect(checkJob("mpesa-poll", null, null, now, 60_000).status).toBe("fail");
    expect(checkJob("mpesa-poll", min(10), true, now, 60_000).status).toBe("fail");
    expect(checkJob("mpesa-poll", min(1), false, now, 60_000).status).toBe("warn");
    expect(checkJob("mpesa-poll", min(1), true, now, 60_000).status).toBe("ok");
    expect(checkJob("renewals", min(60 * 30), true, now, 24 * 3_600_000).status).toBe("ok");
  });

  it("flags STK pushes the poller isn't clearing", () => {
    expect(checkOldestPending(null, now).status).toBe("ok");
    expect(checkOldestPending(min(5), now).status).toBe("ok");
    expect(checkOldestPending(min(20), now).status).toBe("fail");
  });

  it("queues warn when non-empty; missing STK callbacks warn only when expected", () => {
    expect(checkCount("q", "Unmatched", 0, "x").status).toBe("ok");
    expect(checkCount("q", "Unmatched", 2, "x").status).toBe("warn");
    expect(checkLastCallback("stk", null, now, true).status).toBe("warn");
    expect(checkLastCallback("stk", null, now, false).status).toBe("info");
  });
});

describe("env: M4 channels", () => {
  const base = {
    NEXT_PUBLIC_SITE_URL: "https://app.example.co.ke",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    MPESA_CALLBACK_TOKEN: "x".repeat(24),
    CRON_SECRET: "y".repeat(16),
  };
  it("requires the webhook secret with the webhook URL, and https for Slack", () => {
    expect(() => parseServerEnv({ ...base, ALERT_WEBHOOK_URL: "https://example.com/h" })).toThrow(
      /ALERT_WEBHOOK_SECRET/,
    );
    expect(() => parseServerEnv({ ...base, SLACK_WEBHOOK_URL: "http://hooks.slack.com/x" })).toThrow();
    expect(() => parseServerEnv({ ...base, SLACK_WEBHOOK_URL: "https://hooks.slack.com/x" })).not.toThrow();
  });
  it("requires a subject with web push keys, and a well-formed Telegram secret", () => {
    expect(() => parseServerEnv({ ...base, VAPID_PRIVATE_KEY: "k", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p" })).toThrow(
      /VAPID_SUBJECT/,
    );
    expect(() =>
      parseServerEnv({ ...base, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "has spaces in it!!" }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
});
