/**
 * Renewal cycles, end to end at the logic level:
 *   reminder → pay → extended
 *   reminder → no pay → grace → expired
 * The planner is the real one; payment is applied with the same rule as the
 * database's billing_apply_paid_order() (extend from the old period end),
 * which tests/sql/billing.sql verifies against Postgres.
 */
import { describe, expect, it } from "vitest";
import { planRenewals, type RenewalAction, type RenewalSub } from "@/lib/billing/renewals";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-01T03:00:00Z"); // 06:00 Nairobi, when the job runs
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function sub(overrides: Partial<RenewalSub> = {}): RenewalSub {
  return {
    id: "sub_1",
    status: "active",
    periodEnd: at(10),
    graceUntil: null,
    cancelAtPeriodEnd: false,
    renewalMethod: "manual",
    hasOpenBill: false,
    ...overrides,
  };
}

/** A tiny model of the database for one subscription, driven by the real planner. */
function simulate(initial: RenewalSub, graceDays = 3) {
  const s = { ...initial };
  const log: string[] = [];
  const apply = (actions: RenewalAction[]) => {
    for (const a of actions) {
      log.push(a.type === "create_bill" ? `bill:${a.reason}` : a.type === "expire" ? `expire:${a.reason}` : a.type);
      if (a.type === "create_bill") s.hasOpenBill = true;
      if (a.type === "start_grace") {
        s.status = "grace";
        s.graceUntil = a.graceUntil;
        if (a.switchToManual) s.renewalMethod = "manual";
      }
      if (a.type === "expire" || a.type === "cancel")
        (s as { status: string }).status = a.type === "expire" ? "expired" : "canceled";
    }
  };
  return {
    state: s,
    log,
    runDay(day: number) {
      if (!["trialing", "active", "grace"].includes(s.status)) return;
      apply(planRenewals([s], at(day), { graceDays }));
    },
    /** What a paid renewal does in billing_apply_paid_order(). */
    pay(monthMs = 30 * DAY) {
      s.status = "active";
      s.periodEnd = new Date(s.periodEnd.getTime() + monthMs);
      s.graceUntil = null;
      s.hasOpenBill = false; // the bill is paid; other open bills are superseded
      log.push("paid");
    },
  };
}

describe("renewal cycle", () => {
  it("reminder → pay → extended from the old period end", () => {
    const sim = simulate(sub({ periodEnd: at(10) }));
    for (let d = 0; d <= 6; d++) sim.runDay(d);
    expect(sim.log).toEqual([]); // nothing until 3 days before the end

    sim.runDay(7); // 3 days left
    expect(sim.log).toEqual(["bill:reminder"]);
    sim.runDay(8);
    expect(sim.log).toEqual(["bill:reminder"]); // idempotent: one bill, one reminder

    sim.pay();
    expect(sim.state.periodEnd).toEqual(at(40)); // 10 + 30, not day 8 + 30
    for (let d = 9; d <= 36; d++) sim.runDay(d);
    expect(sim.state.status).toBe("active");
    expect(sim.log).toEqual(["bill:reminder", "paid"]);

    sim.runDay(37); // 3 days before the new end: the next cycle starts
    expect(sim.log).toEqual(["bill:reminder", "paid", "bill:reminder"]);
  });

  it("reminder → no pay → grace → expired", () => {
    const sim = simulate(sub({ periodEnd: at(10) }), 3);
    for (let d = 0; d <= 20; d++) sim.runDay(d);
    expect(sim.log).toEqual(["bill:reminder", "start_grace", "expire:grace_ended"]);
    expect(sim.state.status).toBe("expired");
  });

  it("grace lasts exactly GRACE_DAYS after the period end", () => {
    const sim = simulate(sub({ periodEnd: at(10) }), 3);
    for (let d = 0; d <= 10; d++) sim.runDay(d);
    expect(sim.state.status).toBe("grace");
    expect(sim.state.graceUntil).toEqual(at(13));
    sim.runDay(12);
    expect(sim.state.status).toBe("grace");
    sim.runDay(13);
    expect(sim.state.status).toBe("expired");
  });

  it("paying during grace restores the plan, extended from the old end", () => {
    const sim = simulate(sub({ periodEnd: at(10) }), 3);
    for (let d = 0; d <= 11; d++) sim.runDay(d);
    expect(sim.state.status).toBe("grace");
    sim.pay();
    expect(sim.state).toMatchObject({ status: "active", graceUntil: null, periodEnd: at(40) });
    for (let d = 12; d <= 20; d++) sim.runDay(d);
    expect(sim.state.status).toBe("active");
  });
});

describe("planRenewals rules", () => {
  const now = at(0);
  const plan = (s: RenewalSub, graceDays = 3) => planRenewals([s], now, { graceDays });

  it("doesn't remind Ratiba subscriptions (they pay themselves)", () => {
    expect(plan(sub({ periodEnd: at(2), renewalMethod: "ratiba" }))).toEqual([]);
  });

  it("falls back to manual with a bill when a Ratiba period ends unpaid", () => {
    expect(plan(sub({ periodEnd: at(-0.1), renewalMethod: "ratiba" }))).toEqual([
      {
        type: "start_grace",
        subscriptionId: "sub_1",
        graceUntil: new Date(at(-0.1).getTime() + 3 * DAY),
        switchToManual: true,
      },
      { type: "create_bill", subscriptionId: "sub_1", reason: "ratiba_fallback" },
    ]);
  });

  it("expires an unpaid trial at its end, with no grace", () => {
    expect(plan(sub({ status: "trialing", periodEnd: at(-0.1) }))).toEqual([
      { type: "expire", subscriptionId: "sub_1", reason: "trial_ended" },
    ]);
  });

  it("reminds a trial user 3 days before the trial ends", () => {
    expect(plan(sub({ status: "trialing", periodEnd: at(2) }))).toEqual([
      { type: "create_bill", subscriptionId: "sub_1", reason: "reminder" },
    ]);
  });

  it("cancels at period end without grace or reminders when asked", () => {
    expect(plan(sub({ periodEnd: at(2), cancelAtPeriodEnd: true }))).toEqual([]);
    expect(plan(sub({ periodEnd: at(-0.1), cancelAtPeriodEnd: true }))).toEqual([
      { type: "cancel", subscriptionId: "sub_1" },
    ]);
  });

  it("expires straight away when GRACE_DAYS is 0", () => {
    expect(plan(sub({ periodEnd: at(-0.1) }), 0)).toEqual([
      { type: "expire", subscriptionId: "sub_1", reason: "no_grace" },
    ]);
  });

  it("makes sure someone in grace always has a bill to pay", () => {
    expect(plan(sub({ status: "grace", periodEnd: at(-1), graceUntil: at(2) }))).toEqual([
      { type: "create_bill", subscriptionId: "sub_1", reason: "grace" },
    ]);
    expect(plan(sub({ status: "grace", periodEnd: at(-1), graceUntil: at(2), hasOpenBill: true }))).toEqual([]);
  });

  it("doesn't create a second bill when one is open", () => {
    expect(plan(sub({ periodEnd: at(2), hasOpenBill: true }))).toEqual([]);
    expect(plan(sub({ periodEnd: at(-0.1), hasOpenBill: true })).map((a) => a.type)).toEqual(["start_grace"]);
  });
});
