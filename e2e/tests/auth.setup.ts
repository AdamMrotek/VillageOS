import { test as setup, expect } from "@playwright/test";

/** Logs in once through the real UI as the primary seeded user and saves the
 *  session cookies. Every spec in the chromium project starts from this
 *  storageState; only auth.spec.ts drives the login form itself. */
setup("authenticate as e2e-a", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(process.env.E2E_USER_A_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_USER_A_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Seeded users are pre-consented, so login lands straight on the calendar.
  await expect(page).toHaveURL(/\/calendar/);

  await page.context().storageState({ path: ".auth/user.json" });
});
