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
