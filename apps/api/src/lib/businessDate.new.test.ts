import assert from "node:assert/strict";
import { test } from "node:test";
import { bahrainDateString } from "./businessDate.js";

test("a capture just after Bahrain midnight is on the next business day, not the UTC day", () => {
  // 22:30 UTC on 30 Oct is 01:30 on 31 Oct in Bahrain (UTC+3).
  assert.equal(bahrainDateString(new Date("2026-10-30T22:30:00Z")), "2026-10-31");
});

test("the last instant before Bahrain midnight stays on the same day", () => {
  assert.equal(bahrainDateString(new Date("2026-10-30T20:59:59.999Z")), "2026-10-30");
  assert.equal(bahrainDateString(new Date("2026-10-30T21:00:00.000Z")), "2026-10-31");
});
