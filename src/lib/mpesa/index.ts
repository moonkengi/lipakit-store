/**
 * M-Pesa (Daraja) library. Framework-agnostic: pass configuration in, get a
 * client out. The app wires it to env vars in src/lib/payments.
 */
import { createDarajaClient } from "./client";
import { createSimulatorClient, type SimulatorDeps } from "./simulator";
import type { MpesaClient, MpesaConfig } from "./types";

export function createMpesaClient(config: MpesaConfig, deps: SimulatorDeps = {}): MpesaClient {
  return config.mode === "simulator" ? createSimulatorClient(deps) : createDarajaClient(config, deps);
}

export * from "./types";
export { MpesaError, isMpesaError, type MpesaErrorCode } from "./errors";
export { normalizePhone, formatPhone, maskPhone } from "./phone";
export { darajaTimestamp, stkPassword } from "./password";
export { describeResultCode, type ResultCodeInfo } from "./result-codes";
export { parseStkCallback, type ParsedStkCallback } from "./schemas";
export { ACCOUNT_REFERENCE_MAX, TRANSACTION_DESC_MAX } from "./stk";
export {
  assertDarajaSafeUrl,
  C2B_ACCEPT,
  C2B_REJECT_ACCOUNT,
  findBannedKeyword,
  parseC2BPayload,
  type C2BResponseType,
  type ParsedC2BPayment,
  type RegisterC2BInput,
} from "./c2b";
export {
  parseRatibaCallback,
  type ParsedRatibaCallback,
  type RatibaFrequency,
  type StandingOrderInput,
  type StandingOrderResult,
} from "./ratiba";
