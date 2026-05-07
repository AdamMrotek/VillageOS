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
  auth.py      — get_current_user dependency (Clerk JWT verification)
  requirements.txt
```

---

## ADR-006 — Clerk for authentication

**Decision:** Clerk handles user identity in `apps/web`. `clerkMiddleware` protects all routes except `/sign-in` and `/sign-up`.

**Reasons:**
- Clerk issues RS256-signed JWTs that FastAPI can verify without a Clerk SDK
- Hosted sign-in/sign-up UI removes all auth form work
- Works natively with Next.js App Router via `@clerk/nextjs`

**Key files:**
- `apps/web/src/middleware.ts` — route protection
- `apps/web/src/app/layout.tsx` — `ClerkProvider` root wrapper
- `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`
- `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`

**Required env vars** (copy from `.env.local.example`):
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

---

## ADR-007 — JWT verification in FastAPI via Clerk JWKS

**Decision:** FastAPI verifies Clerk-issued JWTs using `PyJWT` + `PyJWKClient`, fetching Clerk's public JWKS once and caching the key set.

**Reasons:**
- Stateless verification — no Clerk SDK or network round-trip per request beyond the initial JWKS fetch
- `PyJWKClient` handles key rotation automatically
- RS256 algorithm; no shared secret required between services

**Flow:**
1. User signs in → Clerk issues a session JWT
2. Next.js frontend calls FastAPI with `Authorization: Bearer <token>`
3. FastAPI's `get_current_user` dependency fetches the signing key from the JWKS cache and calls `jwt.decode`
4. Verified `sub` (Clerk user ID) is available in every protected route handler

**Required env vars** (copy from `apps/api/.env.example`):
```
CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
CLERK_ISSUER=https://<your-clerk-domain>
```
