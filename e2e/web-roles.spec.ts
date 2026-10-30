import { expect, test, type APIRequestContext } from "@playwright/test";

// Seeded Beta Digital users (db/seed/fixtures/merchants.ts). Audit DB only.
// The web app's /v1 proxy forwards these calls, so the request fixture uses the web origin.
const MERCHANT_ID = "3a1a204a-4b91-4739-b955-45e95e2e2e34";
const PASSWORD = "FilsPaySeed!2026";

async function signInMerchant(request: APIRequestContext, email: string) {
  const first = await request.post("/v1/auth/login", {
    data: { merchantId: MERCHANT_ID, email, password: PASSWORD },
  });
  expect(first.status()).toBe(200);
  const { devOtpCode } = (await first.json()) as { devOtpCode: string };
  const verify = await request.post("/v1/auth/otp/verify", { data: { code: devOtpCode } });
  expect(verify.status()).toBe(200);
}

test.describe("merchant role gates on the API", () => {
  test("support can read payment links", async ({ request }) => {
    await signInMerchant(request, "support@betadigital.example");
    const res = await request.get(`/v1/merchants/${MERCHANT_ID}/payment-links`);
    expect(res.status()).toBe(200);
  });

  test("support cannot create a payment link (403 before validation)", async ({ request }) => {
    await signInMerchant(request, "support@betadigital.example");
    const res = await request.post(`/v1/merchants/${MERCHANT_ID}/payment-links`, { data: {} });
    expect(res.status()).toBe(403);
  });

  test("owner passes the role gate on the same route", async ({ request }) => {
    await signInMerchant(request, "owner@betadigital.example");
    const res = await request.post(`/v1/merchants/${MERCHANT_ID}/payment-links`, { data: {} });
    // Empty body fails validation, not the role check: anything but 401/403 proves the gate passed.
    expect([401, 403]).not.toContain(res.status());
  });
});
