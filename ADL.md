# Architectural Decision Log

## ADR-001 — Monorepo with Turborepo + pnpm workspaces

**Decision:** Single repository managed by Turborepo for task orchestration and pnpm workspaces for package management.

**Reasons:**
- Shared packages (UI, types, config) can be consumed by any app without publishing to a registry
- Turborepo caches build/lint/test outputs, preventing redundant work across packages
- pnpm's strict symlink model avoids phantom dependency issues common with npm/yarn hoisting

**Structure:**
```
apps/web          — Next.js application
packages/ui       — Shared component library
```

---

## ADR-002 — Next.js (App Router) for the web application

**Decision:** Next.js 16 with the App Router and TypeScript.

**Reasons:**
- App Router enables React Server Components, reducing client bundle size
- First-class TypeScript support with no extra configuration
- `transpilePackages` allows consuming JSX/TSX from `packages/ui` without a separate compile step

---

## ADR-003 — Tailwind CSS v4

**Decision:** Tailwind CSS v4 with CSS-first configuration (no `tailwind.config.js`).

**Reasons:**
- v4 uses `@import "tailwindcss"` and `@theme inline` in CSS, eliminating a separate config file
- `@source` directive explicitly scans `packages/ui` so component classes are included in the build
- `tw-animate-css` provides animation utilities compatible with v4's engine

---

## ADR-004 — shadcn/ui in `packages/ui`

**Decision:** shadcn components live in `packages/ui` rather than directly in `apps/web`.

**Reasons:**
- Components are owned and editable source code, not a locked dependency
- Centralising them in a workspace package makes them available to any future app in the monorepo
- `components.json` points the shadcn CLI at `packages/ui`, so `pnpm dlx shadcn add <component>` scaffolds directly into the shared package

**Key dependencies:** `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`

---

## ADR-005 — FastAPI backend in `apps/api`

**Decision:** A Python FastAPI service lives at `apps/api`, runs on port 8000, and is started alongside Next.js by `turbo dev` via a minimal `package.json` shim.

**Reasons:**
- FastAPI's async model and automatic OpenAPI docs suit an AI-heavy backend
- Keeping it in the monorepo means a single `pnpm dev` starts the full stack
- Python is the natural home for ML/LLM integrations (LangChain, OpenAI SDK, etc.)

**Setup:**
```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Clerk values
```

**Structure:**
```
apps/api/
  main.py      — FastAPI app, CORS, /health, /api/me
  auth.py      — get_current_user dependency
  requirements.txt
```

---

## ADR-006 — Replace Clerk with Supabase (Auth + DB)

**Decision:** Supersede ADR-006 and ADR-007 by replacing old auth with Supabase for both authentication and the primary PostgreSQL database.

**Reasons:**
- **Data ownership:** Direct access to `auth.users`
- **Simplified stack:** Consolidates identity and database into a single provider
- **Native Postgres:** Provides the foundation for `pgvector`, essential for planned AI/RAG features

**Impact:**
- `apps/web` uses `@supabase/ssr` + `@supabase/supabase-js` for session management via server-side cookies
- `apps/api` (FastAPI) verifies Supabase JWTs **asymmetrically** via `PyJWT` + JWKS fetched from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (see ADR-010)

**Required env vars:**
```
# apps/web/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...

# apps/api/.env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

---

## ADR-007 — Layered FastAPI structure and `events` table

**Decision:** Organise `apps/api` into four explicit layers (`core/`, `schemas/`, `routers/`, `services/`) and store calendar events in a dedicated `events` table with JSONB for nested data and RLS for user isolation.

**Reasons:**
- **Layered structure:** Flat files (`main.py`, `auth.py`, `schemas.py`) become unmanageable as routes multiply. Separating HTTP handling (routers), business logic (services), data shapes (schemas), and shared dependencies (core) keeps each file focused and testable in isolation.
- **JSONB for `action_items`:** Action items are always read and written with their parent event, never queried independently. JSONB avoids a join table while preserving full structure — Pydantic validates the shape on both read and write.
- **RLS over application-level filtering:** Enabling Row Level Security on `events` means a misconfigured query cannot accidentally expose another user's data. (Originally the API used the service role key with `user_id` set explicitly and RLS as a backstop; superseded by ADR-010 — user routes now go through a JWT-scoped client and RLS is load-bearing.)
- **`confidence` column on manual events:** Set to `1.0` for events created directly by the user; populated by the AI extraction pipeline for text-derived events. Allows the frontend to surface low-confidence extractions for review without a separate table.

**See also:** [DATABASE.md](DATABASE.md)

---

## ADR-008 — TanStack Query for server data; Zustand for UI state only

**Decision:** Server data fetched from FastAPI is owned by TanStack Query in `apps/web/src/lib/queries/`. Zustand (`apps/web/src/lib/stores/calendar-store.ts`) holds only ephemeral UI state — `weekAnchor` and `openEventId`. Per-user authed pages do **not** use SSR data fetching; they render as RSC shells and let the client fetch.

**Reasons:**
- **Auth lives between client and FastAPI.** SSR would require an extra Browser→Next→FastAPI hop with no caching benefit.
- **TanStack Query replaces hand-rolled state plumbing.** Cache, request deduping, refetch-on-focus, optimistic updates with rollback, and centralised invalidation come for free. This removes the `router.refresh()` + store re-hydration dance.
- **Keeping server data out of Zustand prevents staleness bugs.**
- **Zustand still earns its keep for UI state** that isn't reachable via a URL or query key (selected event, active week anchor), where the cross-component coordination that a global store provides is exactly the point.

**Tradeoffs:**
- Brief loading state on first paint instead of pre-populated HTML — acceptable for a logged-in app with no SEO requirement.
- ~13 kB gzipped added to the client bundle for `@tanstack/react-query`.

**Impact:**
- `/events` page is a pure RSC shell with no `apiServer` call.
- `QueryClientProvider` mounted once in `apps/web/src/app/(app)/layout.tsx`.
- `useEvents`, `useToggleActionItem`, `useDeleteEvent` defined in `apps/web/src/lib/queries/events.ts`.
- `apps/web/src/lib/api-server.ts` and the `events-provider.tsx` hydrator removed; the previous server-fetched + Zustand-hydrated path is gone.

---

## ADR-009 — AWS Lambda + API Gateway (HTTP API) via SAM for the FastAPI backend

**Decision:** Deploy `apps/api` as a single AWS Lambda function fronted by API Gateway HTTP API, packaged and shipped with AWS SAM. FastAPI runs inside Lambda through the [Mangum](https://github.com/jordaneremieff/mangum) ASGI adapter (`apps/api/lambda_handler.py`). Infrastructure is declared in `apps/api/template.yaml`.

**Reasons:**
- **Cost at idle is effectively zero.** Lambda + HTTP API have generous free tiers and bill per request; the app has no traffic floor to amortise a container or VM against.
- **HTTP API over REST API.** Cheaper per request, lower latency, and the feature set (JWT-friendly routing, CORS, throttling) covers everything the FastAPI service needs. The REST API tier's extra features (request validation, API keys, usage plans) are not in scope.
- **Mangum keeps FastAPI unchanged.** The same `main.py` runs locally under Uvicorn and in Lambda — no framework swap, no handler-per-route rewrite. A single proxy route (`/{proxy+}` ANY) hands every request to FastAPI's router.
- **SAM over raw CloudFormation or CDK.** `sam build` + `sam deploy --guided` gives a one-command path from source to deployed stack, with `samconfig.toml` capturing parameters for subsequent deploys. CDK would add a TypeScript/Python build step in the infra layer for no benefit at this size.
- **arm64 (Graviton) runtime.** ~20% cheaper than x86_64 and ~20% faster for Python workloads; no compatibility issues for this dependency set.

**Cost guards (intentional, declared in `template.yaml`):**
- **HTTP API throttle:** `$default` route capped at 5 req/sec sustained, 10 burst across the whole API. Stops a runaway client or scraper from generating a surprise bill before any application-level rate limiting is in place.
- **CloudWatch log retention:** 7 days on `/aws/lambda/${ApiFunction}` so log storage stays inside the free tier.
- **Reserved concurrency deliberately omitted.** Setting it would require raising the account-level concurrency quota above 10; the upstream HTTP API throttle is the real ceiling.
- **Billing alert** set in the AWS console before first deploy (called out in [BACKEND.md](BACKEND.md#prerequisites)).

**Function sizing:**
- `MemorySize: 1024` MB — enough headroom for JWKS fetch + PyJWT verification on cold start without paying for memory the steady state doesn't use.
- `Timeout: 30` s — comfortably above worst-case LLM extraction latency; API Gateway HTTP API caps integration timeout at 30 s anyway.

**Tradeoffs:**
- **Cold starts.** Python on Lambda typically adds 300–800 ms on a cold invocation, plus the first-ever JWKS fetch. Acceptable for a logged-in app with no SEO surface; revisit with provisioned concurrency or SnapStart if user-facing latency becomes a complaint.
- **Vendor lock-in on the deploy surface.** `template.yaml` and the Mangum entrypoint are AWS-specific. The FastAPI app itself stays portable — moving to Fly/Render/Fargate would mean a new IaC file and dropping `lambda_handler.py`, not a code rewrite.
- **Secrets live in Lambda env vars.** Fine for the current threat model; migrate to AWS Secrets Manager or SSM Parameter Store if/when rotation or multi-environment promotion warrants it.

**Impact:**
- `apps/api/lambda_handler.py` is the Lambda entry; `main.py` remains the local-dev entry.
- `mangum` is a runtime dependency in `apps/api/requirements.txt`.
- Frontend points at the SAM output `ApiUrl` via `NEXT_PUBLIC_API_URL`.
- See [BACKEND.md](BACKEND.md#deploying-to-aws-lambda) for the deploy runbook.

---

## ADR-010 — JWT-scoped Supabase client; RLS is load-bearing

**Decision:** User routes go through `get_user_db` — a per-request Supabase client built with the publishable key and authenticated with the caller's JWT — so queries run as that user and existing `auth.uid() = user_id` policies enforce ownership at the DB. Service-role access (`get_admin_db`, secret key) is reserved for admin paths (cron, AI ingestion).

**Why:** under the previous service-role-everywhere setup, a forgotten `.eq("user_id", ...)` was a data leak; now Postgres applies the filter and service code shrinks (e.g. `set_action_item_done` went from ~30 lines to 6). `INSERT`s must still set `user_id` for the `WITH CHECK` clause to pass.

**Supersedes** the RLS-as-safety-net framing in ADR-007. See [BACKEND.md](BACKEND.md#database-access-pattern).

---

## ADR-011 — Password reset uses OTP/token flow, not PKCE

**Decision:** Password reset emails carry `{{ .Token }}` + `{{ .Email }}` as query params on a link to `/reset-password`, which calls `verifyOtp({ email, token, type: 'recovery' })`. Logged-in password changes live on a separate route (`/settings/password`) using `reauthenticate()` + emailed nonce. "Secure password change" is enabled on the Supabase project so `updateUser({ password })` is rejected unless the caller is in a recovery session or supplies a nonce.

**Reasons:**
- **Cross-device.** PKCE stores a code verifier in `localStorage` on the requesting device; opening the email on another device failed with `code verifier not found`. OTP carries no per-device state.
- **Survives email scanners.** Outlook Safelinks / Mimecast / Barracuda pre-fetch URLs and burn single-use links. Headless scanners don't execute JS, so the JS-side `verifyOtp` call is what actually consumes the token.
- **Bearer-token bypass closed.** With "Secure password change" on, a stolen access token alone can't `PUT /auth/v1/user` to change the password — the attacker also needs access to the user's email.
- **No session fallback on `/reset-password`.** The new-password form only renders after a successful `verifyOtp` *this page load*; a pre-existing session is never enough.

**Tradeoffs:** the email is briefly visible in the URL until `window.history.replaceState` scrubs it (one synchronous tick). Switch to the `token_hash` variant if that exposure is unacceptable.

**See also:** [AUTH.md](AUTH.md)

---

## ADR-012 — GitHub Actions CI with ruff for the Python API

**Decision:** A single `.github/workflows/ci.yml` runs on every push to `main` and every PR, with two parallel jobs:
- **Web** (`pnpm -F @repo/web lint` → `tsc --noEmit` → `pnpm build`) covering `apps/web` + `apps/eval-viewer` via Turborepo.
- **API** (`ruff check .` → `ruff format --check .` → `pytest`) covering `apps/api`.

Eval runs against real LLM providers are deliberately kept *out* of CI for now; when wired up they will live in a separate manual-only `evals.yml` (`workflow_dispatch`).

**Reasons:**
- **GitHub-native, free at this scale.** Public repos get unlimited Actions minutes; even on a private-Free plan this workflow uses ~250 min/month against a 2,000-min allowance. No third-party CI to install, no separate billing surface.
- **Ruff replaces the black + flake8 + isort + pyupgrade stack.** One tool, one config file (`apps/api/ruff.toml`), one binary, ~10× faster than the equivalent legacy chain. Format-on-save and CI use the same engine, so local and CI verdicts never diverge.
- **Pragmatic rule set, not a maximalist one.** `E, F, I, UP, B` covers ~95% of real bugs and style with minimal noise. The selection is deliberately narrower than "everything ruff offers" because every added rule is a tax on PRs that doesn't repay itself unless it catches real defects.
- **shadcn components in `packages/ui` are explicitly out of scope.** They're vendored source from `shadcn add` — owned in the sense.
- **Concurrency cancels stale runs.** `concurrency.group: ci-${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` means a fast follow-up push doesn't pay for the older run.
- **Evals deferred, not abandoned.** Running the extraction matrix on every push would burn OpenAI + Groq credits on changes that can't affect extraction quality (e.g. CSS). Manual `workflow_dispatch` keeps eval-as-CI an *opt-in* signal, gated on judgment about when it earns the API spend.

**Tradeoffs:**
- **No automatic eval regression detection yet.** A prompt or pipeline change that quietly degrades extraction quality won't fail CI until eval is wired up with a `paths:` filter. Acceptable while the dataset is small and iteration is human-paced; revisit when prompt changes start landing without manual eval runs.
- **No deploy job.** `sam deploy` on `main` is still manual. The auth doc lists the runbook; promoting it to CI is a one-job addition once we want push-to-deploy.
- **Two separate jobs, not one toolchain.** The web and api jobs each install their own deps from scratch. Pip + pnpm caching keeps the wall-clock cost low (~3–5 min per run), so the parallel-jobs simplicity wins over a single hand-orchestrated job.

**Impact:**
- `.github/workflows/ci.yml` is the canonical CI definition.
- `apps/api/ruff.toml` is the canonical Python lint/format config; running `ruff check .` and `ruff format .` from `apps/api` matches CI exactly.
- `ruff>=0.7.0` is in `apps/api/requirements-dev.txt`.
- README carries a live CI badge linking to the workflow runs page.

---

## ADR-013 — GitHub Actions deploys the SAM stack via OIDC + a scoped IAM role

**Decision:** A separate workflow `.github/workflows/deploy-api.yml` builds and deploys the FastAPI Lambda stack on every push to `main` that touches `apps/api/**` (plus `workflow_dispatch` as an escape hatch). GitHub Actions authenticates to AWS via OpenID Connect, assuming an IAM role (`github-actions-villageos-deploy`) whose trust policy is scoped to the repo and whose permissions are scoped to `villageos-api-*` resources in `eu-north-1`. No long-lived AWS access keys live in GitHub.

**Reasons:**
- **OIDC over static access keys.** Long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in GitHub secrets are a credential surface that rotates only when you remember. OIDC gives every workflow run a short-lived STS token (default 1 hour), tied cryptographically to the repo + ref via GitHub's identity provider. The trust policy's `sub` condition (`repo:AdamMrotek/VillageOS:*`) means even a compromised fork or PR from elsewhere cannot assume the role.
- **Separate workflow from `ci.yml`, not a deploy job grafted on.** `ci.yml` stays fast, free, and green-on-every-push; `deploy-api.yml` carries its own secrets and IAM concerns. Disabling deploys (e.g. during an incident) is a one-file action that doesn't touch CI. The two-workflow split also keeps the GitHub Actions UI legible — CI runs are checks, deploys are deploys.
- **Path filter on `apps/api/**`.** CSS or web-only changes don't trigger a Lambda redeploy. `apps/web` changes go to Vercel; `apps/api` changes go to AWS. The workflow file itself is also in the path list so editing the deploy pipeline triggers a deploy (so changes are validated immediately).
- **Inline test gating, not `workflow_run` chaining.** The deploy job re-runs `ruff check`, `ruff format --check`, and `pytest` before assuming the AWS role. Yes, this duplicates the work `ci.yml` already did on the same SHA — but `workflow_run` triggers are awkward (no native path filtering, conclusion checks done in script) and the duplicated check is ~30 seconds. The semantic guarantee — "deploy never runs on broken code" — is worth the cheap re-run.
- **Workflow is self-contained; `samconfig.toml` stays gitignored.** The workflow passes `--stack-name`, `--region`, `--resolve-s3`, `--s3-prefix`, and `--capabilities` explicitly. Reading `deploy-api.yml` shows the complete deploy contract without needing a local file. `samconfig.toml` remains a local-dev convenience and stays out of git in case someone later adds a secret to `parameter_overrides`.
- **Parameters via GitHub `secrets` and `vars`.** Secret values (`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`) live in repo secrets; non-secret values (`SUPABASE_URL`, `LLM_PROVIDER`, `ALLOWED_ORIGINS`) live in repo variables. The distinction is enforced by GitHub — variables appear in logs, secrets are masked — so it doubles as a leakage guard.
- **IAM policy scoped by ARN, not `*`.** The deploy role is restricted to `villageos-api-*` resources (Lambda functions, IAM roles, log groups) and the SAM bootstrap stack `aws-sam-cli-managed-default-*`. The role cannot create or modify resources in any other stack, function, or log group in the account. Building this policy iteratively from CloudFormation `AccessDenied` events — rather than starting from `AdministratorAccess` and trimming — produces a tighter result and forces understanding of every action the deploy actually needs.

**Tradeoffs:**
- **Cold start for the IAM policy.** The first few deploys after creating the role surface missing permissions one at a time (`cloudformation:CreateChangeSet` on the SAM bootstrap stack was the first gap caught). Each gap is one line to add and a re-run; ten minutes total. The alternative — grant `*` and never see the gap — produces an unconstrained role that future-you would have to audit blind.
- **OIDC trust policy is an under-documented footgun.** GitHub's `sub` claim is `repo:<owner>/<repo>:ref:refs/heads/<branch>` — not a URL, not the repo's HTTPS path, case-sensitive. The first trust policy on this role had a malformed `sub` (full URL pasted into the placeholder) and silently rejected every assume-role attempt with a generic `Not authorized` error. Once known, the gotcha is trivial; the first time, it cost 20 minutes.
- **`samconfig.toml` and `deploy-api.yml` can drift.** Local `sam deploy` reads samconfig; CI uses CLI flags. If someone updates `parameter_overrides` in samconfig and forgets to mirror it in the workflow, local and CI deploys diverge. Acceptable because the divergence surface is small (3 non-secret parameters), and CI is the source of truth for what's actually deployed.

**Impact:**
- `.github/workflows/deploy-api.yml` is the canonical deploy workflow.
- `apps/api/samconfig.toml` remains gitignored; the workflow does not depend on it.
- AWS account `<account-id>` has an IAM OIDC provider for `token.actions.githubusercontent.com` and a role `github-actions-villageos-deploy` with the trust policy + inline permissions policy described above.
- Required GitHub repository secrets: `AWS_DEPLOY_ROLE_ARN`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`.
- Required GitHub repository variables: `SUPABASE_URL`, `LLM_PROVIDER`, `ALLOWED_ORIGINS`.

**Supersedes** the "No deploy job" tradeoff in ADR-012; push-to-`main` deploy is no longer manual.

---

## ADR-014 — Structured logging + observability

**Decision:** The API logs structured JSON to stdout, which Lambda forwards to CloudWatch where each field is queryable in Logs Insights. Three pieces:

- **`configure_logging()`** swaps the root logger to a `python-json-logger` formatter at startup.
- **`RequestContextMiddleware`** gives every request an ID, times it, logs one access line, and echoes the ID back as the `x-request-id` header.
- **Extraction telemetry** — `extract_event` logs an `extraction_completed` event with model, provider, LLM latency, token usage, confidence, and input length.

A bare `/healthz` returns `{"status": "ok"}`. Canonical queries live in `apps/api/LOGS.md`.

**Reasons:**
- **`python-json-logger`** over `structlog` and stdlib text logs: a one-line formatter swap makes every existing `logger.info(...)` queryable by field, with no call-site changes.
- **Request ID** correlates the access log with the extraction telemetry for the same call, and lets a client or bug report name the exact request to find.
- **Per-extraction telemetry** is the point — token counts come from the provider's `response.usage`, and logging confidence + input length alongside makes cost and prompt-quality questions answerable from logs alone.
- **`/healthz` is a bare 200**, not a dependency check — liveness only; pinging Supabase or the LLM on every probe costs money for little value.

**Out of scope (for now):** Logfire/Axiom forwarding, OpenTelemetry tracing, custom CloudWatch metrics, and Sentry. Each adds a service or cost for marginal gain at one service / one user; CloudWatch + Logs Insights covers the questions we actually ask.

**Impact:**
- `apps/api/app/core/logging.py`, `apps/api/app/core/middleware.py`, `apps/api/app/routers/health.py` — new.
- `apps/api/app/services/extraction.py` — `extract_event` takes an optional `request_id`; route passes `request.state.request_id`.
- `python-json-logger` added to `apps/api/requirements.txt`.
- `apps/api/LOGS.md` is the canonical Logs Insights query set.

---

## ADR-015 — Vercel deploys only `main`, and only on web-affecting changes

**Decision:** Gate the Vercel project (`apps/web`) in-repo via `apps/web/vercel.json`, on two axes:

- **Branch gate** — `git.deploymentEnabled: { "**": false, "main": true }`. Only `main` deploys; every feature branch and PR (including forks) is blocked before a build is considered.
- **Path gate** — `ignoreCommand: "npx turbo-ignore @repo/web"`. On `main`, the build is still skipped unless `@repo/web` or one of its Turborepo dependencies changed, so an `apps/api`-only push doesn't rebuild the web app.

**Impact:**
- `apps/web/vercel.json` — new; the single source of truth for when the web project deploys.

---

## ADR-016 — Anonymous sign-in for the public demo

**Decision:** The one-click "Try the demo" flow uses Supabase `signInAnonymously()` — minting a real `auth.users` row with `is_anonymous=true` and a valid JWT — rather than a shared `demo@…` credential. The landing page `/` is allow-listed for logged-out users in `proxy.ts`; the button signs in anonymously, calls an idempotent, anon-only `POST /api/demo/seed`, and routes to `/events`. Build spec in `Demo-plan.md`.

**Reasons:**
- **Isolation falls out of existing RLS.** An anonymous user is a real `auth.users` row, so the `auth.uid() = user_id` policy (ADR-010) already scopes each guest's events — no new policy, and no shared-account data bleed where one visitor sees another's calendar.
- **API auth is unchanged.** The JWKS verification path (`verify_aud: False`) accepts an anonymous JWT as-is; `sub` is the guest's id, which `create_event` already uses. No special-casing in `auth.py`.
- **No shared-secret token faucet.** A shared `demo@` password leaks the moment it's public and lets anyone burn LLM tokens or read others' data. Per-guest identities plus the tiered quota (ADR-017) make abuse meterable and cappable per caller.
- **Seeding costs zero tokens.** `/api/demo/seed` inserts fully-formed `ParentEvent`s (not raw text to extract), via the user-scoped client so RLS sets `user_id`. Seed dates are computed as offsets from `date.today()` server-side, so the demo never rots into past events.
- **Idempotent + anon-only.** The endpoint no-ops if the guest already has events and 403s a non-anonymous caller, so a refresh or a re-click can't double-seed and a registered user can't trigger it.

**Out of scope (for now):** CAPTCHA on the anonymous endpoint (a toggle to add if scripted account-farming appears; the cost cap is the real backstop), anonymous→permanent account conversion (a single `updateUser` call promotes the row in place, keeping seeded data), and a cleanup cron for stale anonymous users (`ON DELETE CASCADE` already cleans their data when a row is removed).

**Impact:**
- `apps/web/src/proxy.ts` — `/` allow-listed for logged-out users.
- `apps/web/src/app/page.tsx`, `apps/web/src/components/try-demo-button.tsx` — landing + demo entry.
- `apps/web/src/lib/api-client.ts` — `seedDemo()` helper.
- `apps/api/app/routers/demo.py`, `apps/api/app/services/demo_seed.py` — anon-only idempotent seed + curated relative-dated fixture.
- **Supabase dashboard** (not in code): Anonymous sign-ins enabled under Authentication → Providers.

---

## ADR-017 — Per-identity tiered quota, resolved from the JWT

**Decision:** The cost/abuse guard for `/api/extract` is a per-identity **daily quota expressed as tiers**, resolved from the verified JWT with no extra DB round-trip. `resolve_tier(user)`: `is_anonymous` → `demo`; otherwise `app_metadata.tier`; otherwise `free`. `TIER_POLICY` maps each tier to `{daily_cap, model}`. The check is a single atomic upsert (the `bump_usage` SQL function over a `usage_counters` ledger) that increments on attempt; over the cap returns `429`. Tier rides the extract path's `extract_metered` / `quota_exceeded` log events (ADR-014).

**Reasons:**
- **Throttle ≠ quota.** The API Gateway throttle (10 burst / 5 rps, global) is a DoS floor, not a cost cap — 5 rps sustained is ~432k LLM calls/day, all *under* the throttle, and it can't tell a recruiter from an abuser. A per-identity quota answers the different question: "has *this* caller spent its allowance for the window?"
- **Tier lives in the `app_metadata` claim.** Supabase copies `app_metadata` into the access token, so tier is readable off the verified JWT with zero lookup; an upgrade is `admin.updateUserById(uid, {app_metadata:{tier:"pro"}})`, nothing on the hot path. Chosen over a `profiles.tier` column, which would add a per-request join or a cache. Trade-off: a tier change only takes effect on the user's next token refresh — fine for upgrades.
- **One ledger for all tiers, atomic increment.** `usage_counters` (RLS on, **no** user policy → service-role only via `get_admin_db`) generalizes a demo-only table. The check is a single `INSERT … ON CONFLICT … DO UPDATE … RETURNING count`, so two concurrent Lambdas can't both read N and both pass the cap. Increment-on-attempt (not on-success) means hammering a `429` keeps getting rejected and the model never fires for an over-budget caller.
- **Demo pins `model: None`, not a model name.** The demo model must match the active `LLM_PROVIDER` (prod runs groq, whose default fast model is the cheap, eval-vetted Scout). Pinning an OpenAI name like `gpt-4o-mini` would be sent to groq and fail; the 15/day cap is the real cost backstop, so `None` (use the provider default) is both correct and provider-agnostic.
- **Existing and new users default to `free` with no backfill.** Tier is computed per request from the JWT — there is no stored role/tier column — so rolling this out is non-breaking: every registered user resolves to `free` (50/day) the moment the API deploys, and `pro` is opt-in only.

**Out of scope (for now):** a Redis/Upstash token-bucket for sub-second *rate* limiting (defer; Postgres handles the daily *quota* at this scale and reuses infra we already run), API Gateway Usage Plans + API keys (a REST API v1 feature absent on HTTP APIs, and shaped for B2B partners not per-end-user JWTs), and instant downgrades (the claim-freshness lag would need a DB lookup for that path only).

**Impact:**
- `apps/api/app/core/tiers.py` — `resolve_tier`, `TIER_POLICY`, `policy_for`.
- `apps/api/app/services/usage.py` — `bump_usage` (atomic RPC wrapper).
- `apps/api/app/routers/extract.py` — resolve tier → quota gate → pass tier's model.
- `supabase/migrations/20260605000000_create_usage_counters.sql` — `usage_counters` table + `bump_usage` function (execute revoked from anon/authenticated).
- `apps/api/LOGS.md` — `extract_metered` / `quota_exceeded` events + tier-grouped funnel queries.
- `apps/web/src/lib/api-fetch.ts`, `apps/web/src/lib/queries/events.ts` — typed `ApiError` carries the status; `useExtractEvent` surfaces a `429` as a "sign up" CTA.

---

## ADR-018 — Vision extraction: inline base64 to a pinned vision model, no image persistence

**Decision:** Image extraction (photo of a leaflet / WhatsApp screenshot → `ParentEvent`) sends the image **inline** in `POST /api/extract` as a base64 data URL, downscaled client-side (canvas, ≤1568px long edge, JPEG q0.8, ~200–500 KB). The backend builds a multimodal message under the **same `instructor` + `ParentEventDraft` contract** as text, pinned to `openai/gpt-4o` (`vision_model` in `_PROVIDER_CONFIG`) with prompt `v3v` (v3 + a composed vision addendum). Images are never persisted: no S3, redacted from DEBUG logs, never sent to PostHog. Vision requests bypass the extraction-model A/B (ADR follows move 1) and return `experiment: null`; client funnel events carry `input_type` instead. Feature overview in `apps/api/VISION_EXTRACTION.md`.

**Reasons:**
- **Vision-native structured output, not OCR-then-parse.** Leaflet semantics live in layout (dates in headers, prices in small print, decorative fonts); flattening to text first compounds two error modes and loses exactly what matters. One vision call reuses the entire schema/validation/eval machinery unchanged.
- **No storage means no retention problem.** These are photos of children's school communications. The original plan (reuse the provider-cover presign flow) would have created an S3 corpus of them, dragging in lifecycle rules and the data-protection checklist. Client downscale + inline base64 keeps the request ≲500 KB (Lambda's limit is 6 MB), deletes the retention question entirely, and the canvas re-encode converts HEIC to JPEG as a side effect.
- **Pinned provider/model, experiment bypassed.** The A/B arms (Scout, gpt-4o-mini-as-text) are text configurations; letting assignment override the vision model would break image requests on the control arm. Pinning also disables low-confidence escalation, matching arm behaviour. `experiment: null` (rather than a sentinel variant) keeps the PostHog flag's variant space clean for the move-1 analysis; `input_type` on `extraction_shown`/`extraction_accepted` is the filter dimension.
- **`v3v` is composed, not forked.** `SYSTEM_PROMPT = v3 + addendum` keeps one source of truth for field rules while logging an honest version label. The 7-day date table still matters: leaflets print "Friday 19th June" with no year, screenshots say "this Friday".
- **`detail: "high"` is pinned, with eyes open on cost.** The value in a flyer is the small print; `"low"` is a single 512px thumbnail. Measured: ~2,950 prompt tokens, ~$0.008, 2.2–3.9 s per extraction.
- **Vision quality is a tested contract from day one.** Three synthetic golden images (committed generator script, no real children's data) cover: clean flyer with a time range, chat screenshot exercising the date table through vision, and a degraded angled photo requiring year inference. 3/3 pass rule checks on gpt-4o; the eval runner gates image cases to `VISION_CAPABLE` combos.

**Out of scope (for now):** Groq Llama-4 Scout as the vision model (natively multimodal and ~⅓ the cost, but content-part messages are untested under Groq's JSON mode — the planned vision eval should settle it), real-photo golden cases (synthetic renders are an easier test; swap in before quoting quality numbers), attaching the source image to the created event (would reintroduce storage — do it only when it's a feature with a reason), and a vision arm in the online experiment.

**Impact:**
- `apps/api/app/prompts/extraction/v3_vision.py` — `v3v` prompt variant.
- `apps/api/app/services/extraction.py` — multimodal message path, `VISION_PROVIDER`/`get_vision_model`, `_redact_messages`, `input_type`/`image_bytes` telemetry.
- `apps/api/app/schemas/events.py` — optional `raw_text` + validated `image_data_url` (jpeg/png/webp data URL, ~2 MB cap; caption exempt from the 10-char floor).
- `apps/api/app/routers/extract.py` — vision pin + A/B bypass; quota metering unchanged.
- `apps/web/src/lib/image-downscale.ts`, `apps/web/src/app/(app)/events/new/page.tsx` — EXIF-aware canvas downscale; camera/file attach UI; `input_type` on funnel captures.
- `apps/api/tests/golden/img_0{7,8,9}*`, `apps/api/scripts/generate_golden_images.py`, `apps/api/evals/extraction/run.py` — image golden cases, generator, runner support.
- `apps/api/tests/test_extract_schema.py`, `test_extraction_vision.py`, `test_extract_router_vision.py` — 29 tests.

---

## ADR-019 — Extraction A/B arms become provider stacks; vision rides the flag

**Decision:** The `extraction-model` experiment (move 1) is redefined: each arm is now a full **provider stack** serving both the text and the vision path, instead of a text-model pair with vision pinned outside the experiment. **control = the OpenAI stack** (gpt-4o-mini text, gpt-4o vision — the proven configurations), **treatment = the Groq stack** (Llama-4 Scout, natively multimodal, for both paths). `assign_extraction_variant(user_id, vision=...)` picks the arm's `text_model` or `vision_model`; image requests no longer bypass assignment, and `response.experiment` is populated for both input types. With the experiment disabled (no PostHog key) text remains the no-override pre-experiment path and vision falls back to the pinned `VISION_PROVIDER`/`get_vision_model()` default (openai/gpt-4o), so prod-without-PostHog is byte-for-byte unchanged. Supersedes the vision A/B-bypass in ADR-018.

**Reasons:**
- **The blocker behind the bypass is gone.** ADR-018 bypassed the experiment because content-part messages were untested under Groq JSON mode. The 2026-06-12 eval settled it: Scout passed all 19 rule checks on the image golden set through JSON mode, at ~$0.0005 and ~1s per extraction vs gpt-4o's ~$0.008 and ~3s.
- **The funnel becomes the real-photo vision eval.** Synthetic goldens prove plumbing, not the quality envelope. `extraction_shown`/`extraction_accepted` already carry `input_type`, so once real traffic exists the per-field edit-rate metric reads Scout-vision quality on real photos — risk contained to the treatment arm.
- **One provider for the whole surface is the actual business question.** If the Groq stack holds, extraction runs at ~1/15th the vision cost and ~1/16th the text cost with one vendor; the experiment now measures exactly that.
- **Arm relabel is safe pre-launch.** The old arms (control: groq Scout text, treatment: gpt-4o-mini text) had no real traffic; variant keys in PostHog are unchanged and exposure events carry provider/model, so historical rows stay interpretable. The provider-key guard now also falls through to full passthrough when *both* keys are missing, instead of 500ing.

**Impact:**
- `apps/api/app/core/experiments.py` — `_VARIANT_TO_CONFIG` becomes a stack table (`provider`, `text_model`, `vision_model`); `assign_extraction_variant` gains `vision=` and a two-step key guard.
- `apps/api/app/routers/extract.py` — vision joins assignment; pinned default only as disabled-experiment fallback; exposure + `experiment` info on every response.
- `apps/api/app/services/extraction.py` — `VISION_PROVIDER` comment reframed as fallback.
- `apps/api/scripts/provision_posthog_dashboard.py` — dashboard description.
- `apps/api/tests/test_experiments.py`, `test_extract_router_vision.py` — re-pinned to the new contract.

---

## ADR-020 — PostHog for product analytics + experiment assignment

**Decision:** Integrate PostHog as the single tool for both product analytics and A/B experiment control. The extraction model A/B's arm is chosen **server-side** via the `extraction-model` feature flag (keyed on the authenticated user's `sub`); the web SDK `identify()`s with the same Supabase user id so server and client events stitch into one funnel.

**Reasons:**
- **One `distinct_id` across both halves.** Server (`extraction_assigned`) and client (`extraction_shown`, `extraction_accepted`) events join without a separate identity-resolution step.
- **Feature flags double as live experiment control.** The split is adjustable from the dashboard with no deploy; assignment stays deterministic (PostHog hashes `sub + flag key`).
- **Disabled-by-default.** No `POSTHOG_API_KEY` ⇒ production default for everyone, no captures, no behaviour change. Assignment runs *after* the tier quota gate (ADR-017), never bypassing it.
- **Vendor-optional.** The assignment is just a deterministic hash; dropping PostHog would lose the analytics join, not the experiment.
- **Dashboard as code.** The A/B readout dashboard (conversion, mean `n_edited`, most-edited fields — each by variant) is provisioned idempotently by `apps/api/scripts/provision_posthog_dashboard.py` rather than hand-clicked, so it's reproducible and reviewable. It uses a separate personal API key (management) from the app's `phc_…` capture key.

**Impact:**
- `apps/api/app/core/experiments.py` — server-authoritative flag evaluation + `extraction_assigned` capture.
- Web SDK initialised in `apps/web` with `identify()` on the Supabase user id.
- `apps/api/scripts/provision_posthog_dashboard.py` — provisions the A/B insights dashboard via the PostHog API.

**See also:** [apps/api/EXPERIMENTS.md](apps/api/EXPERIMENTS.md) for the methodology and event taxonomy.

---

## ADR-021 — Data-protection posture for the real-parent test (UK GDPR)

**Decision:** Run the early test on a deliberately minimal, proportionate UK GDPR footing rather than full launch compliance. The solo developer is the **controller**; lawful basis is **consent**, captured at sign-up as a version-stamped record (`apps/web/src/lib/privacy.ts`). A one-screen privacy notice (`apps/web/src/app/privacy/page.tsx`) discloses everything; deletion is self-serve via **Settings → Delete account** (`apps/api/app/routers/account.py`).

**Key choices:**
- **No raw-input persistence.** Pasted text and uploaded photos are sent to the extractor and only structured events are stored (`events.raw_text` dropped; images inline-only, never S3 — see ADR-018). The only stored user uploads are provider profile/cover images.
- **LLM sub-processors disclosed + contracted.** OpenAI (vision) and Groq (text) are named in the notice; OpenAI's DPA is executed (UK→US under SCCs/UK Addendum) and training is off, Groq's DPA is auto-incorporated and Zero Data Retention is on.
- **Cookieless analytics.** PostHog (ADR-020) runs with `persistence: "memory"` — no cookie or localStorage on the device — so PECR consent is not engaged and no banner is needed. The funnel still stitches because identity comes from the Supabase user id, not a persisted cookie.

**The working checklist, tiered roadmap (Tier 0 → public launch), and current status are the canonical reference:** [DATA_PROTECTION_CHECKLIST.md](DATA_PROTECTION_CHECKLIST.md). This ADR is a pointer, not a duplicate.

---

## ADR-022 — Google OAuth sign-in + consent as a one-time post-login gate

**Decision:** Add "Continue with Google" alongside email/password, and move privacy-consent capture out of the sign-up form into a single post-login gate (`apps/web/src/app/consent/page.tsx`). Google uses Supabase's PKCE OAuth, which needs a server-side callback (`apps/web/src/app/auth/callback/route.ts`) to run `exchangeCodeForSession`. After login, the proxy redirects any logged-in, non-anonymous user lacking `user_metadata.privacy_consent` to the gate, which writes the version-stamped record (`apps/web/src/lib/privacy.ts`) and lets them through. The routing policy is a pure `resolveRedirect` (`apps/web/src/proxy-rules.ts`), unit-tested against the access matrix.

**Reasons:**
- **One consent path for both methods.** Google redirects away before any checkbox could be shown, so consent can't live on the button. A post-login gate captures it identically for email and Google — and exactly once. This **supersedes** the "captured at sign-up" framing in ADR-021: lawful basis and the version-stamped record are unchanged, only *when/where* consent is collected moves (after first login, before any data entry).
- **No double checkbox, no re-prompting.** The old per-form checkbox appeared twice on `/sign-up` and re-asked returning users. The gate shows once and never again.
- **Demo stays frictionless.** Anonymous demo sessions (ADR-016) are exempt — `is_anonymous` short-circuits the gate, so "Try the demo" is still one click into throwaway sample data.
- **Backend untouched.** Google yields the same Supabase JWT the API already verifies asymmetrically (ADR-006/ADR-010); tier resolution (ADR-017) is unaffected.
- **Routing policy is testable.** Splitting the pure decision from the Supabase/Next plumbing turns the access matrix into a table test (no request mocks); it also fixed a latent bug where a recovery session (ADR-011) on `/reset-password` was bounced to the gate.

**Tradeoffs:**
- **Accounts now exist briefly without a consent record** (between first login and accepting the gate). The proxy makes the gate unavoidable before any app route, so no special-category data is entered first — acceptable, and symmetric with how Google would behave anyway.
- **Google adds an external dashboard dependency** (Google Cloud OAuth client) on top of Supabase — documented in [INTEGRATIONS.md](INTEGRATIONS.md#google-cloud--oauth-social-sign-in).

**See also:** [AUTH.md](AUTH.md#google--oauth-sign-in), [INTEGRATIONS.md](INTEGRATIONS.md#google-cloud--oauth-social-sign-in), ADR-021

---
