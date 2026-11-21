/**
 * One error type for everything that can go wrong talking to M-Pesa.
 * `message` is always safe to show to an end user; details go in `cause`/`daraja`.
 */
export type MpesaErrorCode =
  | "invalid_input" // we refused to send the request (bad phone, amount, ...)
  | "auth" // OAuth failed: wrong consumer key/secret, or app not enabled for the API
  | "rejected" // Daraja answered with an error (bad shortcode, invalid passkey, ...)
  | "timeout" // no answer within the timeout
  | "network" // DNS, TLS, connection reset, ...
  | "invalid_response"; // answered, but not in the shape we expect

export class MpesaError extends Error {
  readonly code: MpesaErrorCode;
  readonly httpStatus?: number;
  /** Daraja's own error fields when present, e.g. { errorCode: "400.002.02", errorMessage: "..." }. */
  readonly daraja?: { errorCode?: string; errorMessage?: string; requestId?: string };

  constructor(
    code: MpesaErrorCode,
    message: string,
    opts: { httpStatus?: number; daraja?: MpesaError["daraja"]; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "MpesaError";
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.daraja = opts.daraja;
  }
}

export function isMpesaError(error: unknown): error is MpesaError {
  return error instanceof MpesaError;
}
