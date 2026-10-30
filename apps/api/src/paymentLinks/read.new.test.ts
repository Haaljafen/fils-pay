import assert from "node:assert/strict";
import { test } from "node:test";
import { toPublicPaymentLinkDto } from "./read.js";

test("the public payment-link DTO exposes only checkout fields, no API-key material", () => {
  const dto = toPublicPaymentLinkDto(
    {
      token: "tok",
      amount_fils: "4750",
      currency: "BHD",
      reference: "INV-1",
      description: null,
      status: "active",
      expires_at: new Date(Date.now() + 3_600_000),
      reserved_at: null,
      merchant_display_name: "Alpha Retail",
    },
    60,
  );
  assert.deepEqual(Object.keys(dto).sort(), [
    "amountFils",
    "currency",
    "description",
    "expiresAt",
    "merchantDisplayName",
    "reference",
    "status",
    "token",
  ]);
  assert.equal(dto.amountFils, 4_750);
});
