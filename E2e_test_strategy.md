# E2E Test Strategy (Playwright)

How the E2E layer works. Rationale: [ADR-024](ADL.md#adr-024--full-stack-e2e-with-playwright-against-a-local-supabase-stack).
Other test layers: [TESTS.md](TESTS.md).

## Goals

Catch regressions in the **plumbing** of the crucial journeys: auth, extraction
(input → FastAPI → LLM → event), the calendar, and provider events. Tests run
deterministically on a laptop and in CI: no paid API calls, no hosted Supabase.

**Non-goals:** LLM output quality (owned by `apps/api/evals`), component
behavior (unit tests), visual regression, and cross-user row ownership (see
[TESTS.md](TESTS.md#rls-and-the-boundary-tests)).

## Running it

```
make e2e           # stack up → db reset → Playwright
make e2e-headed    # visible browser
make e2e-report    # last HTML report
pnpm --filter @repo/e2e test   # skip the reset when the stack is already seeded
```

Needs Docker. `make e2e` resets the local database and stops dev servers on
:3000, :3100 and :8100.

## Architecture

```
Playwright ──► apps/web :3100 ──► apps/api :8100 ──► fake LLM (no network)
                     └───────┬───────┘
                  local Supabase :54321
```

| Decision | Choice | Why |
|---|---|---|
| Apps | Playwright `webServer`, no Docker | Dev server locally, production build in CI. |
| Database + auth | Supabase CLI local stack | Real JWTs, real RLS, real migrations. |
| JWT signing | Committed local-only ES256 key | The API accepts only RS256/ES256 via JWKS; the stack's default HS256 would 401. |
| LLM | `LLM_PROVIDER=fake` + `E2E_FAKE_LLM=1` | The call is server-side, so `page.route()` can't intercept it. The second flag stops a misconfigured real environment serving fixtures. |
| Login | `storageState` from `auth.setup.ts` | One UI login, reused everywhere except `auth.spec.ts`. |
| Ports | 3100 / 8100, e2e only | `reuseExistingServer` can't latch onto a server using the hosted project or a real LLM. |

**Config:** `e2e/playwright.config.ts` is the source of truth. `e2e/.env.e2e` is
committed and holds local-only values. The Supabase secret key is not committed
(GitHub push protection flags it); the config reads it from `supabase status`.

**Fake LLM:** `apps/api/app/services/extraction_fake.py` returns the fixture in
`extraction_fixtures/` whose `trigger` phrase appears in the input, and raises
if none match. Text only. Pinned by `apps/api/tests/test_extraction_fake.py`.

**Seed (`supabase/seed.sql`):**

| User | Role |
|---|---|
| `e2e-a` | Parent, the `storageState` user |
| `e2e-b` | Second parent, not used by a spec yet |
| `e2e-provider` | Provider with a public page |
| `e2e-venue`, `e2e-entertainer` | Provider pages only, no sign-in |

## Suites

| Spec | Covers |
|---|---|
| `auth.spec.ts` | Login, wrong password, logged-out redirect |
| `calendar.spec.ts` | Paste text → extracted draft → event and action items on calendar → Google Calendar / `.ics` export |
| `reservations.spec.ts` | Reserve a provider event → see it change → see it cancelled → remove it |
| `discover.spec.ts` | Browse rows, filter by kind, open an event, search |

## Gotchas

- **Frozen clock:** `calendar.spec.ts` fixes the browser clock to the week of
  2026-09-14 (UTC). The server clock keeps running, so fixtures use absolute
  dates. Keep seed data for `e2e-a` out of that week.
- **Re-runs:** specs must pass without a database reset. Clean up what you
  create or use unique titles.
- **Destructive tests** (e.g. delete account) need their own user, never `e2e-a`.
- **Consent gate:** users without `user_metadata.privacy_consent` are redirected
  to `/consent`, so seeded sign-in users carry a consent record.
- **Dev server lock:** Next 16 allows one dev server per app; stop
  `make frontend` before running Playwright directly.
- **Migrations** must replay from scratch on the local stack.
- **Never run `supabase init` in CI:** it drops `signing_keys_path` and every
  authed request 401s.

## CI

The `e2e` job in `ci.yml` runs in parallel with `web` and `api` (~5–8 min,
20 min timeout, no secrets): pinned Supabase CLI 2.98.2 and production's Postgres
version (CLI 2.98.2's default image crashes; see `ci.yml`) → fresh seeded stack →
`supabase/tests/provider_events.sh` → Playwright → HTML report on failure.

## To do

- `auth.spec.ts`: reset password (read the email from Mailpit, :54324, so keep
  it out of the `supabase start -x` list) and delete account.
- Anonymous-quota spec (429 → sign-up CTA).
- Image extraction in the fake provider.
- Admin app specs (needs a decision on admin access and seed data).
- Nightly `@live` smoke test with a real provider key, outside the PR gate.
