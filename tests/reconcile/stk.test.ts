import { describe, expect, it, vi } from "vitest";
import type { MpesaClient, StkQueryResult } from "@/lib/mpesa";
import { decideSettlement, EXPIRE_AFTER_MS, pollPendingStk, resolveStk } from "@/lib/reconcile/stk";
import { createMemoryStkStore } from "../helpers/memory-stk-store";

const T0 = new Date("2026-11-21T09:00:00Z");

/** An MpesaClient whose STK Query answer we control. */
function fakeMpesa(answer: StkQueryResult | (() => StkQueryResult | Promise<StkQueryResult>)): MpesaClient {
  return {
    mode: "simulator",
    stkPush: vi.fn(),
    registerC2BUrls: vi.fn(),
    createStandingOrder: vi.fn(),
    b2cPayment: vi.fn(),
    stkQuery: vi.fn(async () => (typeof answer === "function" ? answer() : answer)),
  };
}
const final = (resultCode: number, resultDesc = ""): StkQueryResult => ({
  state: "final",
  resultCode,
  resultDesc,
  raw: {},
});
const pending: StkQueryResult = { state: "pending", raw: {} };

describe("decideSettlement", () => {
  const tx = { checkoutRequestId: "ws_1", orderId: "o1", amountKes: 1500, status: "pending" as const, createdAt: T0 };

  it("marks a verified success with matching amount as paid, keeping the receipt", () => {
    const s = decideSettlement({
      tx,
      resultCode: 0,
      resultDesc: "ok",
      hint: { resultCode: 0, amountKes: 1500, receipt: "R1" },
      raw: {},
    });
    expect(s).toMatchObject({ txStatus: "success", orderStatus: "paid", receipt: "R1" });
  });

  it("sends an amount mismatch to needs_review with an explanation", () => {
    const s = decideSettlement({
      tx,
      resultCode: 0,
      resultDesc: "ok",
      hint: { resultCode: 0, amountKes: 1499, receipt: "R1" },
      raw: {},
    });
    expect(s.orderStatus).toBe("needs_review");
    expect(s.orderReason).toMatch(/expected KES 1500.*KES 1499/);
  });

  it("ignores callback details that contradict the verified result", () => {
    // Callback claims success with a receipt, but STK Query says cancelled: trust the query.
    const s = decideSettlement({
      tx,
      resultCode: 1032,
      resultDesc: "cancelled",
      hint: { resultCode: 0, receipt: "FAKE" },
      raw: {},
    });
    expect(s).toMatchObject({ txStatus: "cancelled", orderStatus: "cancelled", receipt: null });
  });

  it("marks a success without callback details (poller path) as paid", () => {
    expect(decideSettlement({ tx, resultCode: 0, resultDesc: "ok", raw: {} }).orderStatus).toBe("paid");
  });
});

describe("resolveStk", () => {
  it("never trusts a callback alone: a forged success is overruled by STK Query", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "ws_1", amountKes: 1500, createdAt: T0 });
    const mpesa = fakeMpesa(final(1037));

    await resolveStk({ store: mem.store, mpesa }, "ws_1", { resultCode: 0, amountKes: 1500, receipt: "FORGED" });

    expect(mpesa.stkQuery).toHaveBeenCalledWith("ws_1");
    expect(mem.orders.get("order-ws_1")?.status).toBe("expired");
    expect(mem.txs.get("ws_1")?.receipt).toBeNull();
  });

  it("is idempotent: processing the same callback twice settles once and skips the second query", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "ws_1", amountKes: 1500, createdAt: T0 });
    const mpesa = fakeMpesa(final(0));
    const hint = { resultCode: 0, amountKes: 1500, receipt: "R1" };

    const first = await resolveStk({ store: mem.store, mpesa }, "ws_1", hint);
    const second = await resolveStk({ store: mem.store, mpesa }, "ws_1", hint);

    expect(first).toMatchObject({ kind: "done", outcome: "settled" });
    expect(second).toMatchObject({ kind: "done", outcome: "noop" });
    expect(mpesa.stkQuery).toHaveBeenCalledTimes(1);
    expect(mem.orders.get("order-ws_1")?.status).toBe("paid");
  });

  it("is race-safe: callback and poller resolving concurrently settle exactly once", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "ws_1", amountKes: 1500, createdAt: T0 });
    const mpesa = fakeMpesa(final(0));

    const results = await Promise.all([
      resolveStk({ store: mem.store, mpesa }, "ws_1", { resultCode: 0, amountKes: 1500, receipt: "R1" }),
      resolveStk({ store: mem.store, mpesa }, "ws_1"),
    ]);

    const outcomes = results.map((r) => (r.kind === "done" ? r.outcome : r.kind));
    expect(outcomes.filter((o) => o === "settled")).toHaveLength(1);
    expect(mem.orders.get("order-ws_1")?.status).toBe("paid");
  });

  it("fills in the receipt when a late callback arrives after the poller settled", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "ws_1", amountKes: 1500, createdAt: T0 });
    const mpesa = fakeMpesa(final(0));

    await resolveStk({ store: mem.store, mpesa }, "ws_1"); // poller: no receipt yet
    expect(mem.txs.get("ws_1")?.receipt).toBeNull();

    const late = await resolveStk({ store: mem.store, mpesa }, "ws_1", {
      resultCode: 0,
      amountKes: 1500,
      receipt: "R1",
    });
    expect(late).toMatchObject({ kind: "done", outcome: "receipt_added" });
    expect(mem.txs.get("ws_1")?.receipt).toBe("R1");
    expect(mem.orders.get("order-ws_1")?.status).toBe("paid");
  });

  it("leaves the transaction pending while STK Query is still processing", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "ws_1", amountKes: 1500, createdAt: T0 });
    const result = await resolveStk({ store: mem.store, mpesa: fakeMpesa(pending) }, "ws_1", { resultCode: 0 });
    expect(result.kind).toBe("still_pending");
    expect(mem.orders.get("order-ws_1")?.status).toBe("pending");
  });

  it("reports an unknown CheckoutRequestID without touching anything", async () => {
    const mem = createMemoryStkStore();
    const mpesa = fakeMpesa(final(0));
    expect(await resolveStk({ store: mem.store, mpesa }, "ws_nope")).toEqual({ kind: "unknown_checkout" });
    expect(mpesa.stkQuery).not.toHaveBeenCalled();
  });
});

describe("pollPendingStk", () => {
  it("only queries pushes older than 60 seconds", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "old", amountKes: 100, createdAt: new Date(T0.getTime() - 90_000) });
    mem.addPending({ checkoutRequestId: "fresh", amountKes: 100, createdAt: new Date(T0.getTime() - 10_000) });
    const mpesa = fakeMpesa(final(0));

    const summary = await pollPendingStk({ store: mem.store, mpesa, now: () => T0 });

    expect(summary).toMatchObject({ checked: 1, settled: 1 });
    expect(mem.orders.get("order-old")?.status).toBe("paid");
    expect(mem.orders.get("order-fresh")?.status).toBe("pending");
  });

  it("expires pushes with no result after 10 minutes", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({ checkoutRequestId: "stale", amountKes: 100, createdAt: new Date(T0.getTime() - EXPIRE_AFTER_MS) });
    mem.addPending({ checkoutRequestId: "waiting", amountKes: 100, createdAt: new Date(T0.getTime() - 120_000) });

    const summary = await pollPendingStk({ store: mem.store, mpesa: fakeMpesa(pending), now: () => T0 });

    expect(summary).toMatchObject({ checked: 2, expired: 1, stillPending: 1 });
    expect(mem.orders.get("order-stale")).toMatchObject({ status: "expired" });
    expect(mem.orders.get("order-waiting")?.status).toBe("pending");
  });

  it("expires an old push whose query keeps failing, and keeps going after errors", async () => {
    const mem = createMemoryStkStore();
    mem.addPending({
      checkoutRequestId: "broken",
      amountKes: 100,
      createdAt: new Date(T0.getTime() - EXPIRE_AFTER_MS - 1),
    });
    mem.addPending({ checkoutRequestId: "ok", amountKes: 100, createdAt: new Date(T0.getTime() - 61_000) });
    const mpesa = fakeMpesa(() => {
      throw new Error("Invalid CheckoutRequestID");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await pollPendingStk({ store: mem.store, mpesa, now: () => T0 });

    expect(summary).toMatchObject({ checked: 2, errors: 2, expired: 1 });
    expect(mem.orders.get("order-broken")?.status).toBe("expired");
    expect(mem.orders.get("order-ok")?.status).toBe("pending");
  });
});
