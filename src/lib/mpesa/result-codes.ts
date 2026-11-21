/**
 * STK push result codes → what they mean for the transaction and the order.
 *
 * Codes come from Daraja callbacks and STK Query responses. Safaricom doesn't
 * publish one complete, authoritative list; the meanings below are the ones
 * commonly observed in sandbox and production. Confirm with Safaricom if you
 * depend on a specific code. Unknown codes are treated as a plain failure.
 */

export type StkTxStatus = "success" | "failed" | "cancelled" | "timeout";
export type StkOrderStatus = "paid" | "failed" | "cancelled" | "expired";

export type ResultCodeInfo = {
  txStatus: StkTxStatus;
  orderStatus: StkOrderStatus;
  /** Human-readable, safe to show the customer. */
  message: string;
  /** Whether trying again straight away is likely to work. */
  retryable: boolean;
};

const known: Record<number, ResultCodeInfo> = {
  0: { txStatus: "success", orderStatus: "paid", message: "Payment received. Thank you!", retryable: false },
  1: {
    txStatus: "failed",
    orderStatus: "failed",
    message: "Your M-Pesa balance is too low for this payment. Top up or use Fuliza, then try again.",
    retryable: true,
  },
  1001: {
    txStatus: "failed",
    orderStatus: "failed",
    message: "Another M-Pesa transaction is in progress on your phone. Wait a moment, then try again.",
    retryable: true,
  },
  1019: {
    txStatus: "timeout",
    orderStatus: "expired",
    message: "The payment request expired before it was completed. Please try again.",
    retryable: true,
  },
  1025: {
    txStatus: "failed",
    orderStatus: "failed",
    message: "We couldn't send the payment prompt to your phone. Please try again.",
    retryable: true,
  },
  1032: {
    txStatus: "cancelled",
    orderStatus: "cancelled",
    message: "You cancelled the payment on your phone.",
    retryable: true,
  },
  1037: {
    txStatus: "timeout",
    orderStatus: "expired",
    message: "We didn't get a response from your phone in time. Make sure it's on and unlocked, then try again.",
    retryable: true,
  },
  2001: {
    txStatus: "failed",
    orderStatus: "failed",
    message: "The M-Pesa PIN was incorrect. Please try again.",
    retryable: true,
  },
  9999: {
    txStatus: "failed",
    orderStatus: "failed",
    message: "We couldn't send the payment prompt to your phone. Please try again.",
    retryable: true,
  },
};

export function describeResultCode(code: number): ResultCodeInfo {
  return (
    known[code] ?? {
      txStatus: "failed",
      orderStatus: "failed",
      message: `The payment didn't go through (M-Pesa code ${code}). Please try again.`,
      retryable: true,
    }
  );
}

/** The codes above, for docs and the simulator. */
export const knownResultCodes = Object.keys(known).map(Number);
