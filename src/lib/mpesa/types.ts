/**
 * Public types for the M-Pesa library.
 *
 * Everything in src/lib/mpesa is framework-agnostic: no Next.js, Supabase or
 * React imports. Configuration is passed in, so the library can be extracted
 * into its own package or ported to another stack.
 */

export type MpesaMode = "simulator" | "sandbox" | "production";

export type StkTransactionType = "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";

export type MpesaConfig = {
  mode: MpesaMode;
  consumerKey: string;
  consumerSecret: string;
  /** BusinessShortCode: the Paybill number, or the store/HO number for a Till. */
  shortcode: string;
  /** Lipa Na M-Pesa Online passkey. */
  passkey: string;
  transactionType: StkTransactionType;
  /**
   * PartyB: who receives the money. Same as `shortcode` for Paybill. For Buy
   * Goods (Till) it is the till number, which can differ from the store number.
   */
  partyB: string;
  /** Per-request timeout for Daraja calls. Default 15s. */
  timeoutMs?: number;
};

export type StkPushInput = {
  /** Any common Kenyan format; normalised to 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: string;
  /** Whole shillings, at least 1. */
  amountKes: number;
  /** Shown to the customer on the prompt. Max 12 characters (confirm with Safaricom). */
  accountReference: string;
  /** Max 13 characters (confirm with Safaricom). */
  description: string;
  /** Full HTTPS URL Daraja will POST the result to. */
  callbackUrl: string;
};

export type StkPushResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
  /** The phone actually sent to Daraja, normalised. */
  phone: string;
  raw: unknown;
};

/**
 * Result of asking Daraja "what happened to this STK push?".
 * `pending` means the customer hasn't finished yet (or Daraja doesn't know yet).
 */
export type StkQueryResult =
  { state: "pending"; raw: unknown } | { state: "final"; resultCode: number; resultDesc: string; raw: unknown };

export interface MpesaClient {
  readonly mode: MpesaMode;
  stkPush(input: StkPushInput): Promise<StkPushResult>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
}

/** Injected dependencies, mainly so tests can control time and the network. */
export type MpesaDeps = {
  fetch?: typeof fetch;
  now?: () => Date;
};
