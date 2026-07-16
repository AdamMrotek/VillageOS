import path from "path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Local-stack URLs, keys, and seeded-user credentials. Committed — everything
// in it is local-only (see .env.e2e). `override` so a hosted-project value
// exported in the shell can never shadow the local-stack values.
dotenv.config({ path: path.resolve(__dirname, ".env.e2e"), override: true });

/** Dedicated port so the e2e web server (wired to the LOCAL Supabase stack)
 *  can never be confused with a normal `pnpm dev` on :3000 that points at the
 *  hosted project — reuseExistingServer would happily reuse the wrong one. */
const WEB_PORT = 3100;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      // CI runs the production build: no dev-compilation flake, and it tests
      // what actually deploys. Locally, dev keeps the fast loop.
      command: process.env.CI
        ? `pnpm --filter @repo/web build && pnpm --filter @repo/web exec next start -p ${WEB_PORT}`
        : `pnpm --filter @repo/web exec next dev -p ${WEB_PORT}`,
      cwd: path.resolve(__dirname, ".."),
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        // Explicit process env beats apps/web/.env.local, so a developer's
        // hosted-project values can't leak into the test run.
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL!,
      },
    },
  ],
});
