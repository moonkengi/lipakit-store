/**
 * Local Daraja simulator. Same interface as the real client, no Safaricom calls.
 *
 * An STK push returns realistic IDs and then, after a delay, fires a real HTTP
 * callback at the app's own callback route, exactly like Daraja would. STK
 * Query answers from the same state. Use it to exercise every failure path,
 * including the ones the official sandbox can't produce.
 *
 * State lives on globalThis so all route handlers in one dev server share it.
 * It is in-memory: restarting the server forgets pending simulated payments.
 * Meant for `pnpm dev` / `pnpm start` on your machine, not serverless hosting.
 */
import { MpesaError } from "./errors";
import { normalizePhone } from "./phone";
import { describeResultCode } from "./result-codes";
import type { StkCallbackPayload } from "./schemas";
import { darajaTimestamp } from "./password";
import type { MpesaClient, MpesaDeps, StkQueryResult } from "./types";

import type { SimulatorOutcome } from "./simulator-outcomes";

export { simulatorOutcomes, outcomeLabels, type SimulatorOutcome } from "./simulator-outcomes";

const resultCodeFor: Record<SimulatorOutcome, number> = {
  success: 0,
  cancelled: 1032,
  timeout: 1037,
  insufficient_funds: 1,
  wrong_pin: 2001,
  duplicate_callback: 0,
  amount_mismatch: 0,
  missing_callback: 0,
  late_callback: 0,
};

export type SimulatedCheckout = {
  merchantRequestId: string;
  checkoutRequestId: string;
  phone: string;
  amountKes: number;
  accountReference: string;
  callbackUrl: string;
  outcome: SimulatorOutcome;
  createdAt: number;
  /** When STK Query starts reporting a final result. */
  resolveAt: number;
  receipt: string;
  callbacksSent: number;
};

export type SimulatorSettings = {
  /** Outcome applied to the next STK push. */
  nextOutcome: SimulatorOutcome;
  /** How long the "customer" takes to respond. */
  delayMs: number;
  /** For late_callback: when the callback finally arrives. Longer than the poller's 60s threshold. */
  lateCallbackDelayMs: number;
};

type SimulatorState = SimulatorSettings & { checkouts: Map<string, SimulatedCheckout> };

const STATE_KEY = Symbol.for("lipakit.mpesa.simulator");
const DEFAULT_SETTINGS: SimulatorSettings = { nextOutcome: "success", delayMs: 3_000, lateCallbackDelayMs: 90_000 };
const MAX_REMEMBERED = 200;

function state(): SimulatorState {
  const g = globalThis as unknown as Record<symbol, SimulatorState | undefined>;
  g[STATE_KEY] ??= { ...DEFAULT_SETTINGS, checkouts: new Map() };
  return g[STATE_KEY];
}

export function getSimulatorSettings(): SimulatorSettings {
  const { nextOutcome, delayMs, lateCallbackDelayMs } = state();
  return { nextOutcome, delayMs, lateCallbackDelayMs };
}

export function updateSimulatorSettings(patch: Partial<SimulatorSettings>): SimulatorSettings {
  Object.assign(state(), patch);
  return getSimulatorSettings();
}

export function listSimulatedCheckouts(): SimulatedCheckout[] {
  return [...state().checkouts.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Forget everything. For tests. */
export function resetSimulator(): void {
  const s = state();
  Object.assign(s, DEFAULT_SETTINGS);
  s.checkouts.clear();
}

export type SimulatorDeps = MpesaDeps & {
  /** Defaults to setTimeout. Tests pass a fake scheduler. */
  schedule?: (fn: () => void, ms: number) => void;
};

export function createSimulatorClient(deps: SimulatorDeps = {}): MpesaClient {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const schedule =
    deps.schedule ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      // Don't keep a test runner or CLI process alive just for a fake callback.
      if (typeof t === "object" && "unref" in t) t.unref();
    });

  async function sendCallback(checkout: SimulatedCheckout, amountOverride?: number) {
    checkout.callbacksSent += 1;
    try {
      await fetchImpl(checkout.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCallbackPayload(checkout, now(), amountOverride)),
      });
    } catch (error) {
      console.error("[mpesa:simulator] could not deliver callback to", checkout.callbackUrl, error);
    }
  }

  return {
    mode: "simulator",

    async stkPush(input) {
      const phone = normalizePhone(input.phone);
      if (!Number.isInteger(input.amountKes) || input.amountKes < 1) {
        throw new MpesaError("invalid_input", "The amount must be a whole number of shillings, at least KES 1.");
      }
      const s = state();
      const createdAt = now().getTime();
      const checkout: SimulatedCheckout = {
        merchantRequestId: `${rand(5, "0123456789")}-${rand(8, "0123456789")}-1`,
        checkoutRequestId: `ws_CO_${darajaTimestamp(new Date(createdAt))}${rand(10, "0123456789")}`,
        phone,
        amountKes: input.amountKes,
        accountReference: input.accountReference,
        callbackUrl: input.callbackUrl,
        outcome: s.nextOutcome,
        createdAt,
        resolveAt: createdAt + s.delayMs,
        receipt: rand(10, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
        callbacksSent: 0,
      };
      s.checkouts.set(checkout.checkoutRequestId, checkout);
      trim(s.checkouts);

      // Schedule the callback(s) the way Daraja would deliver them.
      switch (checkout.outcome) {
        case "missing_callback":
          break;
        case "late_callback":
          schedule(() => void sendCallback(checkout), s.lateCallbackDelayMs);
          break;
        case "duplicate_callback":
          schedule(() => void sendCallback(checkout), s.delayMs);
          schedule(() => void sendCallback(checkout), s.delayMs + 1_000);
          break;
        case "amount_mismatch":
          schedule(() => void sendCallback(checkout, mismatchedAmount(checkout.amountKes)), s.delayMs);
          break;
        default:
          schedule(() => void sendCallback(checkout), s.delayMs);
      }

      return {
        merchantRequestId: checkout.merchantRequestId,
        checkoutRequestId: checkout.checkoutRequestId,
        customerMessage: "Success. Request accepted for processing",
        phone,
        raw: { simulator: true, outcome: checkout.outcome },
      };
    },

    async stkQuery(checkoutRequestId): Promise<StkQueryResult> {
      const checkout = state().checkouts.get(checkoutRequestId);
      if (!checkout) {
        // Mirrors Daraja rejecting an unknown ID. Also what you get after restarting the dev server.
        throw new MpesaError("rejected", "M-Pesa rejected the request: Invalid CheckoutRequestID", {
          httpStatus: 400,
          daraja: { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid CheckoutRequestID" },
        });
      }
      if (now().getTime() < checkout.resolveAt) {
        return { state: "pending", raw: { simulator: true, errorCode: "500.001.1001" } };
      }
      const resultCode = resultCodeFor[checkout.outcome];
      return {
        state: "final",
        resultCode,
        resultDesc: resultDescFor(resultCode),
        raw: { simulator: true, outcome: checkout.outcome },
      };
    },
  };
}

/** A callback body in Daraja's exact shape. */
export function buildCallbackPayload(
  checkout: SimulatedCheckout,
  at: Date,
  amountOverride?: number,
): StkCallbackPayload {
  const resultCode = resultCodeFor[checkout.outcome];
  const callback: StkCallbackPayload["Body"]["stkCallback"] = {
    MerchantRequestID: checkout.merchantRequestId,
    CheckoutRequestID: checkout.checkoutRequestId,
    ResultCode: resultCode,
    ResultDesc: resultDescFor(resultCode),
  };
  if (resultCode === 0) {
    callback.CallbackMetadata = {
      Item: [
        { Name: "Amount", Value: amountOverride ?? checkout.amountKes },
        { Name: "MpesaReceiptNumber", Value: checkout.receipt },
        { Name: "Balance" },
        { Name: "TransactionDate", Value: Number(darajaTimestamp(at)) },
        { Name: "PhoneNumber", Value: Number(checkout.phone) },
      ],
    };
  }
  return { Body: { stkCallback: callback } };
}

function resultDescFor(code: number): string {
  if (code === 0) return "The service request is processed successfully.";
  if (code === 1032) return "Request cancelled by user";
  if (code === 1037) return "DS timeout user cannot be reached";
  if (code === 1) return "The balance is insufficient for the transaction";
  if (code === 2001) return "The initiator information is invalid.";
  return describeResultCode(code).message;
}

function mismatchedAmount(amount: number): number {
  return amount > 1 ? amount - 1 : amount + 1;
}

function rand(length: number, alphabet: string): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function trim(map: Map<string, SimulatedCheckout>) {
  while (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
