import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MpesaError } from "@/lib/mpesa/errors";
import {
  createPaystackClient,
  interpretPaystackTransaction,
  PAYSTACK_RESULT,
  verifyPaystackSignature,
} from "@/lib/mpesa/paystack";
import { resolveStk } from "@/lib/reconcile/stk";
import { createMemoryStkStore } from "../helpers/memory-stk-store";

const SECRET = "sk_test_not_a_real_key";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const push = {
  phone: "0712345678",
  amountKes: 1500,
  accountReference: "LKABCD2345",
  description: "LipaKit",
  callbackUrl: "https://app.example.co.ke/api/hooks/tok/stk",
  email: "buyer@example.com",
};

describe("Paystack stkPush", () => {
  it("sends an M-Pesa charge in cents with a unique reference", async () => {
    const fetch = vi.fn(async () =>
      json(200, { status: true, data: { status: "pay_offline", display_text: "Enter your PIN" } }),
    );
    const client = createPaystackClient({ secretKey: SECRET }, { fetch });
    const res = await client.stkPush(push);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.paystack.co/charge");
    expect(body).toMatchObject({
      email: "buyer@example.com",
      amount: 150_000,
      currency: "KES",
      mobile_money: { phone: "+254712345678", provider: "mpesa" },
    });
    expect(body.reference).toMatch(/^LKABCD2345-[0-9a-f]{8}$/);
    expect(res.checkoutRequestId).toBe(body.reference);
    expect(res.customerMessage).toBe("Enter your PIN");
    expect(client.mode).toBe("sandbox");
  });

  it("needs an email", async () => {
    const client = createPaystackClient({ secretKey: SECRET }, { fetch: vi.fn() });
    await expect(client.stkPush({ ...push, email: undefined })).rejects.toBeInstanceOf(MpesaError);
  });

  it("reports a rejected charge", async () => {
    const fetch = vi.fn(async () => json(400, { status: false, message: "Invalid phone number" }));
    const client = createPaystackClient({ secretKey: SECRET }, { fetch });
    await expect(client.stkPush(push)).rejects.toMatchObject({ code: "rejected" });
  });

  it("maps a bad key to an auth error", async () => {
    const fetch = vi.fn(async () => json(401, { status: false, message: "Invalid key" }));
    const client = createPaystackClient({ secretKey: SECRET }, { fetch });
    await expect(client.stkPush(push)).rejects.toMatchObject({ code: "auth" });
  });

  it("says clearly that C2B, Ratiba and B2C need Daraja", async () => {
    const client = createPaystackClient({ secretKey: SECRET }, { fetch: vi.fn() });
    await expect(client.registerC2BUrls({} as never)).rejects.toThrow(/Daraja shortcode/);
  });

  it("is in production mode with a live key", () => {
    expect(createPaystackClient({ secretKey: "sk_live_x" }).mode).toBe("production");
  });
});

describe("Paystack verify → STK result", () => {
  it("keeps waiting while the customer hasn't finished", () => {
    for (const status of ["pending", "ongoing", "pay_offline", "abandoned"]) {
      expect(interpretPaystackTransaction({ status }, {}).state).toBe("pending");
    }
  });

  it("returns verified amount and receipt on success", () => {
    expect(
      interpretPaystackTransaction(
        { status: "success", amount: 150_000, reference: "LK-1", receipt_number: "SKL1" },
        {},
      ),
    ).toMatchObject({ state: "final", resultCode: 0, amountKes: 1500, receipt: "SKL1" });
  });

  it("maps failure messages onto the kit's result codes", () => {
    const code = (gateway_response: string) =>
      (interpretPaystackTransaction({ status: "failed", gateway_response }, {}) as { resultCode: number }).resultCode;
    expect(code("Transaction cancelled by user")).toBe(PAYSTACK_RESULT.cancelled);
    expect(code("Insufficient balance")).toBe(PAYSTACK_RESULT.insufficientFunds);
    expect(code("Wrong PIN entered")).toBe(PAYSTACK_RESULT.wrongPin);
    expect(code("Request timed out")).toBe(PAYSTACK_RESULT.unreachable);
    expect(code("Something odd")).toBe(PAYSTACK_RESULT.failed);
  });

  it("treats a reference Paystack doesn't know yet as pending", async () => {
    const fetch = vi.fn(async () => json(404, { status: false, message: "Transaction reference not found" }));
    const client = createPaystackClient({ secretKey: SECRET }, { fetch });
    expect((await client.stkQuery("LK-1")).state).toBe("pending");
  });
});

describe("settlement with Paystack", () => {
  it("uses the verified amount, so a short payment goes to review even without a callback", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "LK-1", amountKes: 1500, createdAt: new Date() });
    const fetch = vi.fn(async () =>
      json(200, { status: true, data: { status: "success", amount: 100_000, reference: "LK-1" } }),
    );
    const mpesa = createPaystackClient({ secretKey: SECRET }, { fetch });

    await resolveStk({ store: mem.store, mpesa }, "LK-1");
    expect(mem.orders.get("order-LK-1")?.status).toBe("needs_review");
  });

  it("marks a verified full payment as paid with its receipt", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "LK-2", amountKes: 1500, createdAt: new Date() });
    const fetch = vi.fn(async () =>
      json(200, {
        status: true,
        data: { status: "success", amount: 150_000, reference: "LK-2", receipt_number: "SKL2" },
      }),
    );
    await resolveStk({ store: mem.store, mpesa: createPaystackClient({ secretKey: SECRET }, { fetch }) }, "LK-2");
    expect(mem.orders.get("order-LK-2")?.status).toBe("paid");
    expect(mem.txs.get("LK-2")?.receipt).toBe("SKL2");
  });
});

describe("verifyPaystackSignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "LK-1" } });
  const sign = (b: string, key = SECRET) => createHmac("sha512", key).update(b).digest("hex");
  it("accepts Paystack's signature", () => expect(verifyPaystackSignature(body, sign(body), SECRET)).toBe(true));
  it("rejects a changed body", () => expect(verifyPaystackSignature(body + " ", sign(body), SECRET)).toBe(false));
  it("rejects another key", () =>
    expect(verifyPaystackSignature(body, sign(body, "sk_test_other"), SECRET)).toBe(false));
  it("rejects a missing header", () => expect(verifyPaystackSignature(body, null, SECRET)).toBe(false));
});
