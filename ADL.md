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
- `apps/api` (FastAPI) verifies Supabase JWTs using `PyJWT` with HS256 and `SUPABASE_JWT_SECRET`

**Required env vars:**
```
# apps/web/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# apps/api/.env
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

---

## ADR-007 — Layered FastAPI structure and `events` table

**Decision:** Organise `apps/api` into four explicit layers (`core/`, `schemas/`, `routers/`, `services/`) and store calendar events in a dedicated `events` table with JSONB for nested data and RLS for user isolation.

**Reasons:**
- **Layered structure:** Flat files (`main.py`, `auth.py`, `schemas.py`) become unmanageable as routes multiply. Separating HTTP handling (routers), business logic (services), data shapes (schemas), and shared dependencies (core) keeps each file focused and testable in isolation.
- **JSONB for `action_items`:** Action items are always read and written with their parent event, never queried independently. JSONB avoids a join table while preserving full structure — Pydantic validates the shape on both read and write.
- **RLS over application-level filtering:** Enabling Row Level Security on `events` means a misconfigured query cannot accidentally expose another user's data. The API uses the service role key but sets `user_id` explicitly; the RLS policy acts as a safety net.
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
