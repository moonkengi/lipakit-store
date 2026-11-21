/** Simulator outcome names and labels. Separate file so client components can import them cheaply. */
export const simulatorOutcomes = [
  "success",
  "cancelled",
  "timeout",
  "insufficient_funds",
  "wrong_pin",
  "duplicate_callback",
  "amount_mismatch",
  "missing_callback",
  "late_callback",
] as const;
export type SimulatorOutcome = (typeof simulatorOutcomes)[number];

export const outcomeLabels: Record<SimulatorOutcome, string> = {
  success: "Success",
  cancelled: "User cancelled (1032)",
  timeout: "Timeout, phone unreachable (1037)",
  insufficient_funds: "Insufficient funds (1)",
  wrong_pin: "Wrong PIN (2001)",
  duplicate_callback: "Success, callback sent twice",
  amount_mismatch: "Success, but callback amount differs",
  missing_callback: "Success, callback never arrives (poller must catch it)",
  late_callback: "Success, callback arrives after the poller resolved it",
};
