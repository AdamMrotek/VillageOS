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

## ADR-006,007,008 — Replace Clerk with Supabase (Auth + DB)

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
