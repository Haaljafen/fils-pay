import { expect, test } from "@playwright/test";

// Seeded merchant owner (db/seed/generate.ts). Audit DB only.
const MERCHANT_ID = "9972daab-2c86-459f-9d78-3fe1be4e3280";
const EMAIL = "owner@alpharetail.example";
const PASSWORD = "FilsPaySeed!2026";

test.describe("merchant dashboard auth", () => {
  test("unknown path redirects instead of showing a raw 404", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page).toHaveURL(/\/dashboard\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("protected dashboard redirects to login when signed out", async ({ page }) => {
    await page.goto("/dashboard/transactions");
    await expect(page).toHaveURL(/\/dashboard\/login/);
  });

  test("wrong password is rejected and does not reach the dashboard", async ({ page }) => {
    await page.goto("/dashboard/login");
    await page.getByLabel("Merchant ID").fill(MERCHANT_ID);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Continue" }).click();
    // The API answers one generic code for any bad credential (see LoginPage.tsx).
    await expect(page.getByText(/invalid/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.locator("code")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/dashboard\/transactions/);
  });

  test("password then OTP signs in, and log out returns to login", async ({ page }) => {
    await page.goto("/dashboard/login");
    await page.getByLabel("Merchant ID").fill(MERCHANT_ID);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();

    // Dev mode shows the one-time code on the page (OTP_DEV_EXPOSE, scratch DB only).
    const code = await page.locator("code").first().innerText();
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel("One-time code").fill(code);
    await page.getByRole("button", { name: /verify|continue|sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard\/transactions/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/dashboard\/login/);
  });
});
