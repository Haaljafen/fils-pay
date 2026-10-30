import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCreditRequestInput } from "./creditRequestValidation.js";

// Bahrain business date (UTC+3, no DST) as YYYY-MM-DD, offset by whole days.
function bahrainDate(offsetDays: number): string {
  const ms = Date.now() + offsetDays * 86_400_000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Bahrain" });
}

const base = { baseAmountFils: 1000, reasonCode: "goodwill", reverseFee: false };

// A credit dated in the future would post into a period that has not happened
// yet. The validator's own doc comment says future dates are rejected.
test("a credit effective in the future is rejected", () => {
  assert.throws(
    () => parseCreditRequestInput({ ...base, effectiveDate: bahrainDate(2) }),
    (err: { code?: string }) => err.code === "invalid_effective_date",
  );
});

test("a credit effective today (Bahrain) is accepted", () => {
  const draft = parseCreditRequestInput({ ...base, effectiveDate: bahrainDate(0) });
  assert.equal(draft.effectiveDate, bahrainDate(0));
});

test("a credit effective yesterday is accepted", () => {
  assert.doesNotThrow(() => parseCreditRequestInput({ ...base, effectiveDate: bahrainDate(-1) }));
});
