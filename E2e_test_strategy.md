# E2E Test Strategy (Playwright)

Status: v2 — 2026-07-16. Verified against the codebase; the JWT open question
from v1 is resolved (see "Auth path", below). Nothing is scaffolded yet: no
`supabase/config.toml` (only `migrations/`), no `seed.sql`, no `e2e/` dir, no
Playwright dependency, no `fake` provider entry.

## Goals

Catch regressions in the **plumbing** of the crucial user journeys: auth,
the extraction funnel (input → FastAPI → LLM → rendered event), and saving to
the calendar. Every test must run deterministically on a laptop and in CI, with
no paid API calls, no hosted Supabase project, and no shared mutable state.

**Non-goals:** LLM output *quality* is owned by the eval suite
(`apps/api/evals`, golden set in the admin app) — E2E never judges model output,
only that it flows through the system. Component-level behavior stays in unit
tests; visual regression is out of scope for now.

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Run apps in Docker? | **No** | Playwright's `webServer` boots `next dev` + `uvicorn` directly, same as the Makefile. A parallel Docker setup would drift and adds nothing. |
| Database + auth | **Supabase CLI local stack** (`supabase start`) | One command; runs GoTrue/PostgREST/Postgres containers fully locally (free, nothing travels to supabase.com). Real JWTs, real RLS — auth tests exercise the production path. Existing `supabase/migrations` apply as-is. |
| JWT signing | **Local asymmetric signing key, committed** | The API validates via JWKS with RS256/ES256 only (`apps/api/app/core/auth.py`) — no HS256 path. The local stack's default legacy HS256 secret would 401. `supabase gen signing-key` + `signing_keys_path` in `config.toml`; the key is local-only, safe to commit, identical on laptop and CI. Requires a pinned, recent CLI version. |
| LLM calls | **Fake provider behind `LLM_PROVIDER=fake`** | LLM calls happen server-side in FastAPI, so `page.route()` can't intercept them. A fake branch where `_get_client`/`_PROVIDERS` resolve in `apps/api/app/services/extraction.py` returns canned fixtures — drawn from the golden set so shapes stay realistic. |
| Live-model coverage | One `@live` smoke test | Separate nightly workflow with a real API key from secrets. Never in the PR gate. |
| Login per test? | **No — `storageState`** | One setup project logs in through the UI and saves cookies (`@supabase/ssr` keeps the session in cookies). All other tests reuse the saved state. Exactly one spec exercises the login form itself. |
| Email capture | **Mailpit (Inbucket), part of the local stack** | The reset-password test needs the real recovery email from local GoTrue. Tests poll Mailpit's HTTP API (localhost:54324) for the link. Do not add it to the `-x` skip list. |

## Auth path (verified)

`apps/api/app/core/auth.py` builds a `PyJWKClient` against
`{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and decodes with
`algorithms=["RS256", "ES256"]`. Consequences:

- The local stack **must** be configured with an asymmetric signing key or
  every API call fails auth. This is the first thing to verify in Phase 1.
- No JWT secret ever needs to reach the API's env — only `SUPABASE_URL`.

Account deletion is a real backend route: the settings page
(`packages/ui/src/custom_components/account-settings.tsx`) calls
`DELETE /api/account` → FastAPI `app/routers/account.py`. Per-request DB access
is user-scoped via the caller's JWT (`app/core/db.py`), so RLS is genuinely in
the loop for every data test.

## Stack under test

```
Playwright ──► apps/web  :3000  (Next.js, Supabase cookie session)
          └──► apps/admin:3001  (later phase)
apps/web ────► apps/api  :8000  (FastAPI, Bearer JWT via authedFetch)
apps/api ────► fake LLM provider (no network)
web + api ───► local Supabase stack :54321 (GoTrue, PostgREST, Postgres)
Playwright ──► Mailpit :54324 (recovery-email capture)
```

Env for test runs (`e2e/.env.e2e`, committed — local-only values):

- `apps/web`: `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`, local anon key,
  `NEXT_PUBLIC_API_URL=http://localhost:8000`
- `apps/api`: `LLM_PROVIDER=fake`, `SUPABASE_URL=http://localhost:54321`,
  service-role key from `supabase status`, dummy values for any provider keys
  that `require()` demands at startup

## Repo layout

```
e2e/                        # pnpm workspace member (@repo/e2e)
  playwright.config.ts      # projects: setup → chromium; webServer boots web on :3100
  .env.e2e                  # local-stack URLs, keys, seeded creds (committed — local only)
  fixtures/
    extraction/*.json       # canned fake-provider outputs (from golden set)
  tests/
    auth.setup.ts           # UI login once → .auth/user.json (gitignored);
                            # must live inside testDir or the setup project silently runs 0 tests
    auth.spec.ts            # login, bad password, reset password, delete account
    calendar.spec.ts        # extraction funnel: text → event + actions → calendar
    rls.spec.ts             # cross-user read/write boundary (pen test)
supabase/
  config.toml               # signing_keys_path enabled; seed at ./seed.sql
  signing_keys.json         # local-only asymmetric ES256 key (committed)
  seed.sql                  # e2e-a / e2e-b, pre-confirmed + pre-consented
  migrations/               # applied by `supabase db reset` (baseline fixed to be replayable)
```

Implementation notes (learned while building Phase 1):

- **Consent gate:** the proxy redirects any signed-in user without
  `user_metadata.privacy_consent` to `/consent`. Seeded users carry a consent
  record matching what `app/consent` writes, so login lands on `/calendar`.
- **Dedicated port 3100:** the e2e web server never shares :3000 with a normal
  dev session, so `reuseExistingServer` can't latch onto a server pointed at
  the hosted project. Env passed by `webServer` overrides `.env.local`.
- **Next 16 single-dev-server lock:** two dev servers can't share one
  `apps/web/.next`, so stop `make frontend` before a local e2e run.
- **Replayable migrations:** the baseline migration used
  `CREATE TYPE IF NOT EXISTS` (not valid Postgres — it had never run locally);
  now an idempotent DO block. New migrations must stay locally replayable.
- **New-style local keys:** the CLI issues `sb_publishable_...` /
  `sb_secret_...` shared defaults; the publishable key is the web app's
  "anon key". JWKS + ES256 login verified working end-to-end.

## The three suites

### 1. `auth.spec.ts` — login, reset password, delete account

- **Login**: correct credentials land in the app; wrong password surfaces the
  error. The only spec that drives the login form (everything else reuses
  `storageState`).
- **Reset password**: `forgot-password` page → poll Mailpit for the recovery
  email → follow the link to `reset-password` → set a new password → old
  password fails, new one logs in.
- **Delete account**: drive the settings-page danger zone (`DELETE
  /api/account`), assert redirect + that login now fails.
  **Isolation rule:** this test creates its own throwaway user (sign-up
  in-test, or a dedicated third seeded user) — never the shared `storageState`
  user, or it poisons every test after it.

### 2. `calendar.spec.ts` — extraction funnel + calendar + actions

Logged-in via `storageState`:

1. Freeze browser time with Playwright's `clock` API (respects the
   `useToday()`/`useWeekAnchor()` SSR convention; no week-boundary flake).
2. Open the calendar → assert the visible week is empty.
3. Go to add-event → submit fixture-trigger text → FastAPI runs extraction with
   the fake provider → canned event (including action items) renders.
4. Save → calendar shows the event in the right week **and** the actions view
   lists its items.

Determinism traps:

- The `clock` API freezes the **browser** only — the FastAPI server clock keeps
  running. Fixtures must therefore use **absolute dates** (inside the frozen
  week) so server-side relative-date resolution can't drift.
- The empty-week assertion depends on seed data: the `storageState` user must
  own no events in the frozen week.

### 3. `rls.spec.ts` — cross-user read/write boundary (pen test)

Seed: user A owns one event. Acting as user B (second storage state):

- **Read**: B's calendar and API listings never contain A's event.
- **Write**: direct API calls with B's JWT (Playwright request context) —
  `PATCH`/`DELETE` on A's event ID, and an insert forging A's `user_id` —
  expect 403/404/no-op, verified by re-reading as A.

Leans on real local GoTrue + the actual RLS policies + the per-request
user-scoped client, so it's a genuine boundary test, not a mock.

Dropped from v1 scope (deliberate, easy to add later): the anonymous-quota spec
(unauthed extraction + 429 → sign-up CTA). It needs no auth state, so it can
slot in whenever.

## Key implementation pieces

### 1. Supabase local stack

- `supabase init` → commit `config.toml`. Pin the CLI version (signing-key
  support requires a recent one; pinning also stabilizes the CI image cache).
- `supabase gen signing-key` → commit; set `signing_keys_path` in
  `config.toml`.
- Skip unneeded services: `supabase start -x studio,imgproxy,edge-runtime,...`
  — **keep Mailpit**.
- `seed.sql`: users `e2e-a@test.local` / `e2e-b@test.local`, pre-confirmed,
  known passwords; one pre-seeded event owned by A (for `rls.spec.ts`).
- Reset per run: `supabase db reset` applies migrations + seed → every run
  starts from a known state.

### 2. Fake LLM provider

Add a `fake` entry/branch where `_get_client` resolves providers in
`apps/api/app/services/extraction.py`: when `llm_provider == "fake"`, skip
instructor/OpenAI entirely and return a fixture parsed into the response model.
Fixture selection: keyword matching on the input text (each fixture file names
the phrase that triggers it). Fixtures include action items and absolute dates.
Unit-test the seam so it can't silently break E2E.

### 3. Playwright config sketch

```ts
// e2e/playwright.config.ts
export default defineConfig({
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: ".auth/user.json" },
      dependencies: ["setup"] },
  ],
  use: { trace: "on-first-retry" },
  webServer: [
    // CI runs the production build: no dev-compilation flake, and it tests
    // what actually deploys. Locally, dev keeps the fast loop.
    { command: process.env.CI
        ? "pnpm --filter web build && pnpm --filter web start"
        : "pnpm --filter web dev",
      url: "http://localhost:3000",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI },
    { command: "cd ../apps/api && .venv/bin/uvicorn main:app --port 8000",
      url: "http://localhost:8000/health", reuseExistingServer: !process.env.CI,
      env: { LLM_PROVIDER: "fake" } },
  ],
});
```

## CI/CD impact

Additive change to `ci.yml`: one new `e2e` job alongside the existing `web` and
`api` jobs, running **in parallel** with them.

- **Runtime:** ~5–8 min. Docker image pulls are 1–3 min cold — mitigated by
  pinning the CLI version and skipping services. Cache Playwright browsers
  (`~/.cache/ms-playwright`); install via
  `npx playwright install --with-deps chromium`.
- **Zero secrets:** the well-known local anon/service-role keys plus the
  committed signing key make `.env.e2e` identical on laptop and CI. No GitHub
  secrets, no hosted project, no external calls (`LLM_PROVIDER=fake`). Only
  public Docker image pulls leave the runner.
- **Isolation:** every CI run gets a fresh stack; parallel PRs never share
  state. The existing `concurrency` group already cancels superseded runs.
- **Docker requirement:** satisfied on `ubuntu-latest`; only a concern if CI
  ever moves to macOS runners or Docker-less self-hosted setups.
- **Job shape:** checkout → pnpm install + Python venv →
  `supabase/setup-cli` (pinned) → `supabase start -x ...` → `supabase db reset`
  → `playwright test` → upload HTML report + traces on failure
  (`if: always()`). Set `timeout-minutes` on the job so a hung stack can't
  burn 6 hours of runner time.
- **Never run `supabase init` in CI.** It would regenerate a default
  `config.toml` without `signing_keys_path` — the API's JWKS-only validation
  would then 401 every authed request. The committed config is the source of
  truth; CI only runs `start`/`db reset`.
- **No hand-rolled server startup.** Playwright's `webServer` boots web + api
  and waits on their health URLs itself — no `&`-backgrounded processes or
  `wait-on` steps in the workflow, and local/CI behavior stays identical.
- **`deploy-api.yml` untouched** for now; optionally gate deploys on the e2e
  job later.
- **`@live` smoke:** separate nightly workflow with the real provider key from
  secrets. Excluded from the PR gate.

Local workflow: `supabase start` (once) → `supabase db reset` → `pnpm e2e`,
wrapped as `make e2e`.

## To-do list, in order

**Foundations**

1. ✅ `supabase init` → `config.toml` committed; ES256 signing key generated +
   committed (`signing_keys.json`); baseline migration made replayable.
   Still open: pin the CLI version (local install is 2.98.2).
2. ✅ Auth path smoke-verified: JWKS serves the key (public part only) and a
   seeded user obtains an ES256-signed JWT from local GoTrue. Still open:
   boot the API against the stack (first calendar-suite task).
3. ✅ `supabase/seed.sql`: `e2e-a` / `e2e-b`, pre-confirmed + pre-consented.
   Still open: pre-seeded event owned by A (needed by `rls.spec.ts`).
4. Fake provider seam in `extraction.py` + fixture files (action items,
   absolute dates) + a unit test on the seam.
5. ✅ Playwright scaffold: `@repo/e2e` workspace, config with `webServer` for
   web on :3100 (API server to be added), `.env.e2e`,
   `tests/auth.setup.ts` → `storageState`.

**The three suites**

6. 🔶 `auth.spec.ts` — login green (valid → `/calendar`, wrong password error,
   logged-out redirect). Still open: reset password (Mailpit), delete account
   (own throwaway user).
7. `calendar.spec.ts` (frozen clock, empty-week assert, fake extraction,
   calendar + actions asserts).
8. `rls.spec.ts` (UI read isolation + direct-request write attempts).

**CI**

9. ✅ `make e2e` wrapper (stack up → `db reset` → Playwright; plus `e2e-headed`
   and `e2e-report`) and the `e2e` job in `ci.yml`: pinned CLI 2.98.2, fresh
   stack (start applies migrations + seed), Playwright browser cache, report
   uploaded on failure. CI mode (`CI=true` → production build) verified
   locally.
10. Later: `@live` nightly workflow, anonymous-quota spec, admin-app specs.

## Remaining open questions

- Admin app auth/roles: how is admin access gated? Determines the later
  admin-spec's seed data.
- Vision/image extraction: the fake provider should eventually cover the image
  path too (`VISION_EXTRACTION.md`); text-only is fine for the first pass.
