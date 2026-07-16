# VillageOS — Testing Reference

How testing is structured across the monorepo, what runs in CI, and how to run
each layer locally. Decisions behind these choices live in the ADL:
[ADR-012](ADL.md#adr-012--github-actions-ci-with-ruff-for-the-python-api) (CI +
ruff), [ADR-010](ADL.md#adr-010--jwt-scoped-supabase-client-rls-is-load-bearing)
(RLS is load-bearing), [ADR-024](ADL.md#adr-024--full-stack-e2e-with-playwright-against-a-local-supabase-stack)
(E2E). E2E depth lives in [E2e_test_strategy.md](E2e_test_strategy.md).

## The layers

The suite is a pyramid: many fast unit/integration tests, a few architectural
guards, and a small number of expensive full-stack E2E journeys. Each layer
catches a failure mode the others structurally can't.

| Layer | Where | Runner | What it proves |
|---|---|---|---|
| **Web unit** | `apps/web` (e.g. `src/proxy-rules.test.ts`) | vitest | Frontend logic in isolation (routing/consent rules, components). |
| **API unit / integration** | `apps/api/tests/` | pytest | Schemas, extraction pipeline, quota, provider factory, fake-LLM seam. |
| **Architectural guards** | `apps/api/tests/test_db_boundary.py` | pytest (AST walk) | Structural invariants — e.g. user routes never touch the RLS-bypassing service-role client. |
| **DB / RLS guard** | `apps/api/tests/test_rls_coverage.py` | pytest (migration parse) | Every `public` table has RLS enabled (see [RLS guard](#rls-and-the-boundary-tests)). |
| **E2E** | `e2e/` (`@repo/e2e`) | Playwright + local Supabase | Real browser → Next.js → FastAPI → Postgres, real auth + RLS; LLM faked. |

## Running tests locally

```bash
# Web (vitest)
pnpm -F @repo/web test

# API (pytest) — from apps/api with the venv active
cd apps/api && source .venv/bin/activate && pytest

# E2E (Playwright): starts local Supabase, resets to seeded state, runs the suite
make e2e            # headless, full run
make e2e-headed     # visible browser windows for debugging
make e2e-report     # open the HTML report from the last run

# Iterating on specs with the stack already up + seeded (skips the reset):
pnpm --filter @repo/e2e test
```

E2E needs Docker running (for `supabase start`) and stops any dev server on
:3000/:3100/:8100 first, since Next 16 allows only one dev server per app dir.

## Lint & format (Python)

Ruff is the single tool for Python lint + format (replaces black + flake8 +
isort + pyupgrade). Config: `apps/api/ruff.toml` — `py312`, line length 100,
rule set `E, F, I, UP, B` (`B008` ignored for FastAPI's `Depends(...)` idiom).
Run from `apps/api`, matching CI exactly:

```bash
ruff check .            # lint
ruff format --check .   # format verification (CI); drop --check to apply
mypy                    # type check
```

Web side: `pnpm -F @repo/web lint` (ESLint) and `pnpm -F @repo/web exec tsc --noEmit`.

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main` and every PR, as
parallel jobs. `concurrency` cancels superseded runs; a fast follow-up push
doesn't pay for the older one.

| Job | Steps | ~Time |
|---|---|---|
| **Web** | lint → `tsc --noEmit` → vitest → `pnpm build` | ~3–5 min |
| **API** | `ruff check` → `ruff format --check` → `mypy` → `pytest` | ~3–5 min |
| **E2E** | pinned Supabase CLI → `supabase start` (fresh, seeded) → cached Chromium → Playwright (production build under `CI=true`); HTML report uploaded on failure | ~5–8 min |

Because the jobs run in parallel, the PR gate's wall time is the slowest job
(E2E), not the sum. E2E uses **no GitHub secrets** — the local stack runs on the
CLI's shared default keys plus a committed local-only signing key.

Deploys are separate: `deploy-api.yml`
([ADR-013](ADL.md#adr-013--github-actions-deploys-the-sam-stack-via-oidc--a-scoped-iam-role))
ships the FastAPI Lambda on `apps/api/**` changes via OIDC; Vercel deploys
`apps/web` on `main`
([ADR-015](ADL.md#adr-015--vercel-deploys-only-main-and-only-on-web-affecting-changes)).
Eval runs against real LLM providers stay **out** of CI (cost + non-determinism)
and are manual `workflow_dispatch` when wired up.

## RLS and the boundary tests

Row ownership is enforced at the database, not in application code
([ADR-010](ADL.md#adr-010--jwt-scoped-supabase-client-rls-is-load-bearing)):
user routes go through a JWT-scoped Supabase client (`get_user_db`) and RLS
policies decide what rows are visible. Two independent, cheap tests guard this —
and they cover *different layers*:

1. **`test_db_boundary.py` (endpoint layer).** Walks the AST of every module
   under `app/` and fails if the RLS-bypassing service-role client
   (`get_admin_db`), the raw client factory, or the secret key appears outside
   an explicit allowlist. This forces every new endpoint to make a conscious,
   reviewable choice about which client it uses.

2. **`test_rls_coverage.py` (data layer).** Asserts every table in the `public`
   schema has RLS **enabled**. It parses the migration set — the schema's source
   of truth — and fails if any `CREATE TABLE` has no matching
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` across the migrations. The
   equivalent live check is:
   ```sql
   SELECT tablename FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity = false;
   ```
   Parsing migrations (rather than querying a live DB) lets it run as a real
   gate in the API pytest job — no Supabase stack, no extra dependency — so a
   *future* table shipped without RLS fails CI without anyone editing the test.
   Deliberate server-only tables go in the file's `RLS_EXEMPT` set with a reason
   (currently empty; `usage_counters` needs no exemption — see the note below).

**Why both.** The endpoint test proves a route uses the user-scoped client — but
that client is only safe *because RLS is on* for the table it touches. The
endpoint test can't see whether RLS is actually enabled; the structural guard
can't see which client a route picks. A table can have a perfectly-scoped
endpoint and still be wide open. Postgres/PostgREST also expose every RLS-off
table directly over HTTP, independent of our FastAPI routes — so RLS, not the
endpoint, is the real boundary.

**What they prove — and don't.** Together the two guards prove routes use the
JWT-scoped client *and* that RLS is **enabled** on every public table. They do
**not** prove a policy is *correct* — a table with RLS on but a too-broad
`USING (true)` policy would still pass. Policy correctness (that
`auth.uid() = user_id` actually filters rows) is checked by manual/exploratory
testing, not automated here; a policy-level assertion is open follow-up.

**Why not a browser cross-user pen test.** A per-table E2E ("user B can't delete
user A's event") only exercises the tables it names; it catches a regression on
`events` but is blind to a future table with RLS off — the failure mode that
scales. The two guards above close that at a fraction of the cost, without a
browser. See [ADR-024](ADL.md#adr-024--full-stack-e2e-with-playwright-against-a-local-supabase-stack).

> `usage_counters` has **RLS on but no user policy** by design
> ([ADR-017](ADL.md#adr-017--per-identity-tiered-quota-resolved-from-the-jwt)):
> RLS-on with zero policies is default-deny for end users, i.e. server-only
> access via `get_admin_db`. It is the most locked-down state, so it satisfies
> the "RLS enabled" guard with no exception needed.

## Further reading

- [E2e_test_strategy.md](E2e_test_strategy.md) — E2E architecture, the three
  suites, determinism traps, and the implementation roadmap.
- [DEVELOPMENT.md](DEVELOPMENT.md) — local setup, running the stack, ports.
- [ADL.md](ADL.md) — the decisions behind all of the above.
