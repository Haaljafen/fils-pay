import { formatBhd, toFils } from "@filspay/money";

/**
 * The dashboard's display helpers. Deliberately thin: `bhd` delegates to
 * `@filspay/money`'s `formatBhd`, the same formatter the checkout page uses,
 * so there is exactly one answer to "how is a BHD amount shown" across both
 * halves of this app. Never `/1000`, never `toFixed`.
 */
/** Signed: reconciliation gaps and adjustments can be negative. */
export function bhd(amountFils: number): string {
  return `${formatBhd(toFils(amountFils, { allowNegative: true }))} BHD`;
}

/** `—` for a null/absent value, so an empty table cell is visibly empty
 *  rather than ambiguously blank. */
export function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/** Asia/Bahrain wall time, the zone settlement days and reports are cut in (not the browser's). */
export function dateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bahrain" }) : "—";
}

/**
 * An `<input type="date">` value (YYYY-MM-DD) as the ISO instant its
 * Asia/Bahrain business day starts — the same day boundary settlement
 * batches use, so "transactions from 29 Oct" means the payments in the
 * 29 Oct batch. Bahrain is UTC+3 with no DST.
 */
export function dayStartIso(dateValue: string): string | undefined {
  return dateValue ? new Date(`${dateValue}T00:00:00+03:00`).toISOString() : undefined;
}

/**
 * A `<input type="datetime-local">` value (local wall time, no zone) as an
 * ISO 8601 instant. `new Date(local)` interprets it in the browser's own
 * timezone, which is what the user meant when they typed it.
 */
export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
