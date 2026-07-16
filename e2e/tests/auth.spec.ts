import { test, expect } from "@playwright/test";

/** The one spec that exercises the login form itself — everything else reuses
 *  the storageState captured in auth.setup.ts. Start logged-out. */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login", () => {
  test("valid credentials land on the calendar", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(process.env.E2E_USER_A_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_USER_A_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Pre-consented seed user: the proxy sends them straight to the app.
    await expect(page).toHaveURL(/\/calendar/);
  });

  test("wrong password shows the error and stays on the form", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(process.env.E2E_USER_A_EMAIL!);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Copy from sign-in-form.tsx for the invalid-credentials branch (web
    // passes signUpHref, so the sign-up hint is included).
    await expect(page.getByText("Wrong email or password")).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("app routes redirect logged-out visitors to the login page", async ({
    page,
  }) => {
    await page.goto("/calendar");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
