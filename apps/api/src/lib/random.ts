import { randomInt } from "node:crypto";

// Every helper here draws from crypto.randomInt, never Math.random: these
// values are OTP codes and payment-link tokens, and Math.random's state can be
// recovered from a few observed outputs, making every later value predictable.

/** Generates a string of `n` random decimal digits (e.g. "042817"). One draw
 *  per digit, so any length is exact and uniform. */
export function randomDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += String(randomInt(10));
  }
  return out;
}

/** Generates a string of `n` characters drawn uniformly from `alphabet`. */
export function randomFromAlphabet(alphabet: string, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** Short display-only reference for receipts and logs (e.g. "FP-A7K2M3"). */
export function displayReference(): string {
  return `FP-${randomFromAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6)}`;
}
