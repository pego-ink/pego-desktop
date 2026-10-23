/** A fresh random nonce (32 hex chars) for one armed element picker. */
export const createPickerNonce = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** Whether a page message carries the armed picker's nonce (no picker armed: never). */
export const hasPickerNonce = (message: unknown, nonce: string | undefined): boolean =>
  nonce !== undefined &&
  typeof message === "object" &&
  message !== null &&
  (message as { nonce?: unknown }).nonce === nonce;
