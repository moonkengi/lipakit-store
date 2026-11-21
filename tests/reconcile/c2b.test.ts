import { describe, expect, it, vi } from "vitest";
import { parseC2BPayload } from "@/lib/mpesa";
import { buildC2BPayload } from "@/lib/mpesa/simulator";
import { decideC2B, isPayableAccountRef, processC2BPayment, type C2BStore } from "@/lib/reconcile/c2b";

const payment = (over: Partial<Parameters<typeof buildC2BPayload>[0]> = {}) =>
  parseC2BPayload(
    buildC2BPayload({
      transId: "TX12345678",
      accountRef: "lkab12cd34 ",
      amountKes: 1500,
      phone: "0712345678",
      now: new Date("2026-11-21T09:00:00Z"),
      ...over,
    }),
  );

function store(over: Partial<C2BStore> = {}): C2BStore {
  return {
    findOrderByAccountRef: vi.fn(async () => null),
    findSubscriptionByRatibaRef: vi.fn(async () => null),
    findOrdersByPhoneAndAmount: vi.fn(async () => []),
    settle: vi.fn(async () => "settled" as const),
    ...over,
  };
}

describe("parseC2BPayload", () => {
  it("normalises the account number, amount, phone and time", () => {
    expect(payment()).toMatchObject({
      transId: "TX12345678",
      accountRef: "LKAB12CD34",
      amountKes: 1500,
      phone: "254712345678",
      phoneIsPlain: true,
      paidAt: new Date("2026-11-21T09:00:00Z"),
    });
  });

  it("flags a masked/hashed MSISDN as not usable for matching", () => {
    const body = {
      ...buildC2BPayload({ transId: "T1", accountRef: "X", amountKes: 10, phone: "0712345678" }),
      MSISDN: "2547 ***** 678",
    };
    expect(parseC2BPayload(body).phoneIsPlain).toBe(false);
  });
});

describe("decideC2B", () => {
  it("matches by account number and checks the amount", () => {
    const d = decideC2B(payment(), {
      byRef: { id: "o1", amountKes: 1500, status: "pending" },
      ratiba: null,
      byPhone: [],
    });
    expect(d).toMatchObject({ matchedBy: "account_ref", orderId: "o1", orderStatus: "paid" });
  });

  it("sends a wrong amount to needs_review", () => {
    const d = decideC2B(payment({ amountKes: 1000 }), {
      byRef: { id: "o1", amountKes: 1500, status: "pending" },
      ratiba: null,
      byPhone: [],
    });
    expect(d.orderStatus).toBe("needs_review");
    expect(d.reason).toMatch(/expected KES 1500, received KES 1000/);
  });

  it("matches a Ratiba subscription by its standing-order reference", () => {
    const d = decideC2B(payment(), { byRef: null, ratiba: { id: "s1", priceKes: 1500 }, byPhone: [] });
    expect(d).toMatchObject({ matchedBy: "ratiba", subscriptionId: "s1", orderId: null, orderStatus: "paid" });
  });

  it("falls back to phone + amount only when exactly one order fits", () => {
    const one = decideC2B(payment(), {
      byRef: null,
      ratiba: null,
      byPhone: [{ id: "o9", amountKes: 1500, status: "expired" }],
    });
    expect(one).toMatchObject({ matchedBy: "phone_amount", orderId: "o9" });
    const two = decideC2B(payment(), {
      byRef: null,
      ratiba: null,
      byPhone: [
        { id: "o9", amountKes: 1500, status: "pending" },
        { id: "o8", amountKes: 1500, status: "pending" },
      ],
    });
    expect(two).toMatchObject({ matchedBy: "none", orderId: null });
    expect(two.reason).toMatch(/assign manually/);
  });

  it("leaves anything else unmatched, naming the account number typed", () => {
    expect(decideC2B(payment(), { byRef: null, ratiba: null, byPhone: [] })).toMatchObject({
      matchedBy: "none",
      reason: expect.stringContaining("LKAB12CD34"),
    });
  });
});

describe("processC2BPayment", () => {
  it("doesn't look further once the account number matches", async () => {
    const s = store({ findOrderByAccountRef: vi.fn(async () => ({ id: "o1", amountKes: 1500, status: "pending" })) });
    await processC2BPayment(s, payment(), {});
    expect(s.findSubscriptionByRatibaRef).not.toHaveBeenCalled();
    expect(s.findOrdersByPhoneAndAmount).not.toHaveBeenCalled();
    expect(s.settle).toHaveBeenCalledWith(
      expect.objectContaining({ transId: "TX12345678" }),
      expect.objectContaining({ orderId: "o1" }),
      {},
    );
  });

  it("searches by phone within the 48 hours before the payment", async () => {
    const s = store();
    await processC2BPayment(s, payment(), {});
    expect(s.findOrdersByPhoneAndAmount).toHaveBeenCalledWith("254712345678", 1500, new Date("2026-11-19T09:00:00Z"));
  });

  it("skips phone matching when the phone is masked", async () => {
    const s = store();
    const masked = { ...payment(), phone: "2547****678", phoneIsPlain: false };
    await processC2BPayment(s, masked, {});
    expect(s.findOrdersByPhoneAndAmount).not.toHaveBeenCalled();
  });
});

describe("isPayableAccountRef (validation in match mode)", () => {
  it("accepts unpaid orders and Ratiba refs, rejects paid or unknown ones", async () => {
    expect(
      await isPayableAccountRef(
        store({ findOrderByAccountRef: vi.fn(async () => ({ id: "o", amountKes: 1, status: "pending" })) }),
        "A",
      ),
    ).toBe(true);
    expect(
      await isPayableAccountRef(
        store({ findOrderByAccountRef: vi.fn(async () => ({ id: "o", amountKes: 1, status: "paid" })) }),
        "A",
      ),
    ).toBe(false);
    expect(
      await isPayableAccountRef(
        store({ findSubscriptionByRatibaRef: vi.fn(async () => ({ id: "s", priceKes: 1 })) }),
        "A",
      ),
    ).toBe(true);
    expect(await isPayableAccountRef(store(), "A")).toBe(false);
    expect(await isPayableAccountRef(store(), "")).toBe(false);
  });
});
