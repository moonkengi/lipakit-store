/**
 * End-to-end payment scenarios through the simulator: STK push → simulated
 * customer → callback(s) delivered to our processing logic → poller. Each
 * simulator outcome must end in the right order status.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseStkCallback } from "@/lib/mpesa";
import {
  createSimulatorClient,
  resetSimulator,
  updateSimulatorSettings,
  type SimulatorOutcome,
} from "@/lib/mpesa/simulator";
import { POLL_AFTER_MS, pollPendingStk, resolveStk } from "@/lib/reconcile/stk";
import { createMemoryStkStore } from "../helpers/memory-stk-store";

type Scheduled = { at: number; fn: () => void };

function harness() {
  let now = new Date("2026-11-21T09:00:00Z").getTime();
  const queue: Scheduled[] = [];
  const mem = createMemoryStkStore();
  const deliveries: unknown[] = [];

  // Callbacks "posted" by the simulator go straight into the same code path the route uses.
  const fetchToApp = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    deliveries.push(payload);
    const cb = parseStkCallback(payload);
    await resolveStk({ store: mem.store, mpesa }, cb.checkoutRequestId, {
      resultCode: cb.resultCode,
      amountKes: cb.amountKes,
      receipt: cb.receipt,
      phone: cb.phone,
    });
    return new Response("{}");
  }) as typeof fetch;

  const mpesa = createSimulatorClient({
    fetch: fetchToApp,
    now: () => new Date(now),
    schedule: (fn, ms) => queue.push({ at: now + ms, fn }),
  });

  /** Advance the fake clock, running due callbacks (and awaiting their processing). */
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > target) break;
      queue.shift();
      now = next.at;
      next.fn();
      await new Promise((r) => setTimeout(r, 0)); // let the async callback chain finish
      await new Promise((r) => setTimeout(r, 0));
    }
    now = target;
  }

  async function pay(outcome: SimulatorOutcome, amountKes = 1500) {
    updateSimulatorSettings({ nextOutcome: outcome, delayMs: 3_000, lateCallbackDelayMs: 90_000 });
    const push = await mpesa.stkPush({
      phone: "0712345678",
      amountKes,
      accountReference: "LKTEST2345",
      description: "Test",
      callbackUrl: "http://localhost:3000/api/mpesa/callback/tok/stk",
    });
    const { orderId } = mem.addPending({
      checkoutRequestId: push.checkoutRequestId,
      amountKes,
      createdAt: new Date(now),
    });
    return {
      checkoutRequestId: push.checkoutRequestId,
      order: () => mem.orders.get(orderId)!,
      tx: () => mem.txs.get(push.checkoutRequestId)!,
    };
  }

  const poll = () => pollPendingStk({ store: mem.store, mpesa, now: () => new Date(now) });

  return { pay, advance, poll, deliveries, mem };
}

beforeEach(() => resetSimulator());
afterEach(() => resetSimulator());

describe("simulator scenarios", () => {
  it.each([
    ["success", "paid", "success"],
    ["cancelled", "cancelled", "cancelled"],
    ["timeout", "expired", "timeout"],
    ["insufficient_funds", "failed", "failed"],
    ["wrong_pin", "failed", "failed"],
  ] as const)("%s → order %s via the callback", async (outcome, orderStatus, txStatus) => {
    const h = harness();
    const p = await h.pay(outcome);
    await h.advance(3_000);
    expect(p.order().status).toBe(orderStatus);
    expect(p.tx().status).toBe(txStatus);
    expect(h.deliveries).toHaveLength(1);
  });

  it("success stores the M-Pesa receipt from the callback", async () => {
    const h = harness();
    const p = await h.pay("success");
    await h.advance(3_000);
    expect(p.tx().receipt).toMatch(/^[A-Z0-9]{10}$/);
  });

  it("duplicate_callback → paid once; the second callback is a no-op", async () => {
    const h = harness();
    const p = await h.pay("duplicate_callback");
    await h.advance(5_000);
    expect(h.deliveries).toHaveLength(2);
    expect(p.order().status).toBe("paid");
    // The second delivery reaches the store but changes nothing.
    expect(h.mem.outcomes).toEqual(["settled", "noop"]);
  });

  it("amount_mismatch → needs_review", async () => {
    const h = harness();
    const p = await h.pay("amount_mismatch");
    await h.advance(3_000);
    expect(p.order().status).toBe("needs_review");
    expect(p.order().reason).toMatch(/Amount mismatch/);
  });

  it("missing_callback → still pending until the poller finds it paid", async () => {
    const h = harness();
    const p = await h.pay("missing_callback");
    await h.advance(30_000);
    expect(h.deliveries).toHaveLength(0);
    expect(p.order().status).toBe("pending");

    await h.advance(POLL_AFTER_MS); // past the poller's 60s threshold
    await h.poll();
    expect(p.order().status).toBe("paid");
  });

  it("late_callback → the poller settles first, the late callback only adds the receipt", async () => {
    const h = harness();
    const p = await h.pay("late_callback");
    await h.advance(61_000);
    await h.poll();
    expect(p.order().status).toBe("paid");
    expect(p.tx().receipt).toBeNull();

    await h.advance(30_000); // callback arrives at 90s
    expect(h.deliveries).toHaveLength(1);
    expect(p.order().status).toBe("paid");
    expect(p.tx().receipt).toMatch(/^[A-Z0-9]{10}$/);
  });

  it("STK Query reports pending until the simulated customer responds", async () => {
    const mpesa = createSimulatorClient({ schedule: () => {} });
    updateSimulatorSettings({ nextOutcome: "success", delayMs: 60_000 });
    const push = await mpesa.stkPush({
      phone: "0712345678",
      amountKes: 10,
      accountReference: "X",
      description: "X",
      callbackUrl: "http://localhost/cb",
    });
    await expect(mpesa.stkQuery(push.checkoutRequestId)).resolves.toMatchObject({ state: "pending" });
    await expect(mpesa.stkQuery("ws_CO_unknown")).rejects.toMatchObject({ code: "rejected" });
  });
});
