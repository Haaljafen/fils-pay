import { expect, test } from "@playwright/test";

// Seeded admin (db/seed/generate.ts). Audit DB only.
const SUPER_EMAIL = "superadmin@filspay.test";
const SUPPORT_EMAIL = "support@filspay.test";
const PASSWORD = "FilsPayAdminSeed!2026";

async function signInAdmin(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const code = await page.locator("code").first().innerText();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("One-time code").fill(code);
  await page.getByRole("button", { name: /verify|continue|sign in/i }).click();
}

test.describe("admin console auth", () => {
  test("unknown path redirects to the console", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("super admin signs in, sees merchants, and logs out", async ({ page }) => {
    await signInAdmin(page, SUPER_EMAIL);
    await expect(page).toHaveURL(/\/merchants$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("support admin signs in", async ({ page }) => {
    await signInAdmin(page, SUPPORT_EMAIL);
    await expect(page).toHaveURL(/\/merchants$/);
  });
});
