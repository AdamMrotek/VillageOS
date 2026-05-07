# VillageOS — Frontend

## Environment variables

Copy the example file and fill in the Clerk keys from **Clerk dashboard → API Keys**:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_API_URL` | Base URL of the FastAPI backend (e.g. `http://localhost:8000`) |

---

## Managing JS dependencies

```bash
# Add to a specific app or package
pnpm add <package> --filter @repo/web
pnpm add <package> --filter @repo/ui
pnpm add -D <package> --filter @repo/web   # dev dependency

# Add to the monorepo root (build tooling only)
pnpm add -D -w <package>
```

---

## Build, lint, format

```bash
# Build all apps and packages (Turbo caches outputs)
pnpm build

# Build only the web app
pnpm build --filter @repo/web

# Lint all
pnpm lint

# Format all
pnpm format
```

---

## shadcn components

Components are installed into `packages/ui`, not `apps/web`, so they are available to any future app in the monorepo.

```bash
pnpm dlx shadcn add <component>
# example:
pnpm dlx shadcn add dialog
```

The `components.json` in `packages/ui` directs the CLI to the correct location automatically.

---

## Auth flow (frontend side)

1. User signs in at `/sign-in` — Clerk issues a session JWT.
2. Read the token in a Server Component or Server Action:
   ```ts
   import { getToken } from "@clerk/nextjs/server";
   const token = await getToken();
   ```
   Or in a Client Component:
   ```ts
   import { useAuth } from "@clerk/nextjs";
   const { getToken } = useAuth();
   const token = await getToken();
   ```
3. Pass it to the API as a Bearer token:
   ```ts
   const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/me`, {
     headers: { Authorization: `Bearer ${token}` },
   });
   ```

See [BACKEND.md](BACKEND.md#auth-flow-backend-side) for how FastAPI verifies the token.
