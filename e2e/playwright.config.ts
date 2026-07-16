import { execSync } from "child_process";
import path from "path";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Local-stack URLs, keys, and seeded-user credentials. Committed — everything
// in it is local-only (see .env.e2e). `override` so a hosted-project value
// exported in the shell can never shadow the local-stack values.
dotenv.config({ path: path.resolve(__dirname, ".env.e2e"), override: true });

/** The service-role key for the local stack. Deliberately NOT committed to
 *  .env.e2e: it's the CLI's shared local default (identical everywhere, works
 *  only against 127.0.0.1), but GitHub push protection flags the `sb_secret_`
 *  prefix regardless, so we pull it from the running stack instead. The stack
 *  is a precondition for the suite anyway. Returns "" when the stack isn't up
 *  (e.g. `playwright show-report`) — the API webServer that needs it will then
 *  fail loudly with a clear missing-key error rather than crashing config load. */
function localSecretKey(): string {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  try {
    const out = execSync("supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.match(/^SECRET_KEY="?([^"\n]+)"?/m)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** Dedicated port so the e2e web server (wired to the LOCAL Supabase stack)
 *  can never be confused with a normal `pnpm dev` on :3000 that points at the
 *  hosted project — reuseExistingServer would happily reuse the wrong one. */
const WEB_PORT = 3100;
const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Same isolation story for the API: a normal `make backend` on :8000 points
 *  at the hosted project and a real LLM — the e2e API gets its own port so
 *  reuseExistingServer can only ever reuse a fake-provider server. */
const API_PORT = 8100;

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
    {
      // FastAPI with the fake LLM provider: deterministic canned extractions,
      // no network, no provider key. main.py's load_dotenv() does not override
      // env that's already set, so these values beat any apps/api/.env.
      command: `.venv/bin/uvicorn main:app --port ${API_PORT}`,
      cwd: path.resolve(__dirname, "../apps/api"),
      url: `http://localhost:${API_PORT}/healthz`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        LLM_PROVIDER: "fake",
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY!,
        SUPABASE_SECRET_KEY: localSecretKey(),
        // The browser calls the API cross-origin from the e2e web port.
        ALLOWED_ORIGINS: WEB_URL,
      },
    },
  ],
});
