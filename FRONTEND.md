# VillageOS — Frontend

## Environment variables

Copy the example file and fill in the Supabase keys from **Supabase dashboard → Project Settings → API Keys**:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key (`sb_publishable_...`); env var name kept as `ANON_KEY` for `@supabase/ssr` ergonomics |
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

## Data fetching, mutations & errors (TanStack Query)

All server I/O goes through TanStack Query hooks in `src/lib/queries/*`. Components
never call `apiClient`/`fetch` directly and never render a raw `error.message`.

**1. One hook per read/write.** Reads are `useQuery`, writes are `useMutation`,
both colocated in `src/lib/queries/`. See `src/lib/queries/events.ts`.

**2. Errors are toasted centrally.** `src/components/query-provider.tsx` wires a
`QueryCache` + `MutationCache` whose `onError` fires a `toast.error(...)`
(via [sonner](#shadcn-components)). Components do **not** catch fetch errors for
display. Tune the copy per hook with `meta`:

```ts
useMutation({
  mutationFn: (id: string) => apiClient(`/api/events/${id}`, { method: "DELETE" }),
  meta: { errorMessage: "Couldn't delete the event. Please try again." },
});

// Handling the error yourself (inline UI, custom flow)? Opt out of the toast:
useMutation({ mutationFn, meta: { suppressErrorToast: true } });
```

Without `errorMessage`, queries show `"Couldn't load your data…"` and mutations
show `"Something went wrong…"`. The `<Toaster />` is mounted in `(app)/layout.tsx`.

**3. Success is opt-in, not automatic.** Add `toast.success(...)` in a call-site
`onSuccess` only where it adds value. Most successes are conveyed by the UI
updating (navigation, list invalidation, optimistic state) and need no toast.

**4. Loading has two shapes:**

- **Queries** → overlay the container with `<LoadingOverlay loading={isPending || isFetching} />`
  (the container must be `relative`). See `week-grid.tsx`, `month-calendar.tsx`,
  `prep-list.tsx`.
- **Mutations** → drive the trigger off `mutation.isPending`: disable it and swap
  the label, or use the shared `Button`'s `loading` prop
  (`<Button loading={mut.isPending}>Save</Button>`), which shows a spinner and
  disables automatically.

**Anti-patterns:** `apiClient` inside a component `try/catch`; `useState` error
strings rendered as `<p className="text-destructive">`; bespoke `loading` booleans
alongside a mutation that already exposes `isPending`.

---

## Dates & hydration

Dates are resolved **on the client only**, never during SSR. The server renders in
UTC, so computing `new Date()` while rendering would bake a server-timezone date
into the initial HTML and cause an off-by-one hydration mismatch (e.g. the wrong
day highlighted, or the wrong month shown near a boundary).

**Convention:**

- `today` and `weekAnchor` live in the calendar store (`src/lib/stores/calendar-store.ts`)
  and are `null` until the client populates them after mount via `init()`. Never
  compute them eagerly at module load or in a `useState` initializer — both run
  during SSR.
- Read them through `useToday()` / `useWeekAnchor()`, which return `null` until
  mounted. Guard date-dependent UI on a non-null value: render a skeleton or a
  neutral placeholder until the date resolves.
- Derive other client dates (e.g. the displayed month) from `today` rather than
  from a fresh `new Date()`. See `src/components/month-calendar.tsx`, where the
  month anchor is derived from `today` plus an offset.
- `new Date()` is fine inside **event handlers** (e.g. "jump to today") — those
  only ever run on the client.

---

## Auth flow (frontend side)

Authentication uses Supabase SSR with server-side cookie-based sessions.

**Key packages:** `@supabase/supabase-js`, `@supabase/ssr`

**Session flow:**
1. User signs in via Supabase Auth UI at `/sign-in`
2. `@supabase/ssr` stores the session in an HttpOnly cookie
3. `src/middleware.ts` refreshes the session on every request
4. Server Components create a server-side Supabase client:
   ```ts
   import { createServerClient } from "@supabase/ssr";
   ```
5. Client Components use the browser client:
   ```ts
   import { createBrowserClient } from "@supabase/ssr";
   ```

**OAuth ("Continue with Google"):** the shared
`src/components/google-sign-in-button.tsx` (on the landing sign-in form and
`/sign-up`) calls `signInWithOAuth({ provider: "google" })` with a
`redirectTo` of `/auth/callback`. The PKCE `code` is exchanged for a session
server-side in `src/app/auth/callback/route.ts`, then the user is redirected to
`/calendar`. First-time users (email or Google) are sent by the proxy to the
one-time `/consent` gate (`src/app/consent/page.tsx`) before they can use the
app. See [AUTH.md](AUTH.md#google--oauth-sign-in).

**Calling the FastAPI backend:**
```ts
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;

const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/me`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

See [BACKEND.md](BACKEND.md#auth-flow-backend-side) for how FastAPI verifies the token.
