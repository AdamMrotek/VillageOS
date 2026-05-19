# VillageOS — Database Reference

## Provider

Supabase (managed PostgreSQL). Acts as both the auth provider and the primary database. All tables live in the `public` schema alongside Supabase's built-in `auth.users`.

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | `apps/api/.env` | REST / auth base URL — also used to fetch JWKS public keys for JWT verification |
| `SUPABASE_PUBLISHABLE_KEY` | `apps/api/.env` | `sb_publishable_...` — base key for per-request, JWT-scoped clients in user routes; RLS enforced |
| `SUPABASE_SECRET_KEY` | `apps/api/.env` | `sb_secret_...` — server-only, bypasses RLS. Reserved for admin paths |
| `NEXT_PUBLIC_SUPABASE_URL` | `apps/web/.env` | Client-side Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/web/.env` | Client-side publishable key (env var name kept as `ANON_KEY` for `@supabase/ssr` ergonomics) |

> **New API key format.** VillageOS uses Supabase's [new `sb_publishable_` / `sb_secret_` key format](https://supabase.com/docs/guides/getting-started/api-keys), not the legacy `anon` / `service_role` JWT keys. The new secret key returns HTTP 401 if accidentally used in a browser.

> **No shared JWT secret.** VillageOS uses Supabase's **asymmetric JWT signing** (RS256/ES256), not the legacy HS256 shared-secret flow. See [Authentication](#authentication) below.

---

## Authentication

The FastAPI service verifies Supabase access tokens **asymmetrically**:

1. Supabase signs every user JWT with its private RS256/ES256 key.
2. On first request after cold start, `PyJWKClient` fetches the matching public keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` and caches them in memory.
3. Each protected request: extract the bearer token, look up the signing key by `kid`, verify against the cached public key.

Why this matters:

- **No `SUPABASE_JWT_SECRET` env var needed.** The server only needs the public URL — the private key never leaves Supabase. Rotating the signing key on Supabase's side requires no redeploy.
- **`SUPABASE_URL` is therefore load-bearing for auth**, not just for REST calls. If it's missing or wrong at cold start, every authenticated request fails.
- This is the modern Supabase auth flow (rolled out 2024). Older tutorials and the legacy Supabase Python SDK examples still show the HS256 + shared secret pattern — ignore those for this codebase.

Implementation: `apps/api/app/core/auth.py`.

---

## Migrations

Migration files live in `supabase/migrations/` and are named `<timestamp>_<description>.sql`. Run them in the Supabase dashboard → SQL editor, or via the Supabase CLI:

```bash
supabase db push
```

---

## Tables

### `events`

Stores calendar events belonging to a user. Created by `supabase/migrations/20260508000000_create_events.sql`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, auto-generated |
| `user_id` | `uuid` | FK → `auth.users(id)`, cascade delete |
| `title` | `text` | Max 60 chars (enforced in API layer) |
| `event_type` | `text` | One of: `school` `sport` `birthday` `fundraiser` `meeting` `deadline` `other` |
| `start_time` | `timestamptz` | Required |
| `end_time` | `timestamptz` | Optional |
| `is_all_day` | `boolean` | Defaults to `false` |
| `location` | `text` | Optional |
| `description` | `text` | Max 120 chars (enforced in API layer) |
| `action_items` | `jsonb` | Array of `{description, cost_estimate_gbp?}` objects |
| `confidence` | `float` | 0–1, populated by AI extraction or set to `1.0` for manual entries |
| `created_at` | `timestamptz` | Auto-set to `NOW()` |

**Row-level security:** enabled and **load-bearing**. The `users_own_events` policy restricts all operations to rows where `auth.uid() = user_id`. User routes go through `get_user_db` in `apps/api/app/core/db.py`, which builds a per-request Supabase client scoped to the caller's JWT — so every query runs as that user and RLS does the filtering. Service-layer code does not add `.eq("user_id", ...)` filters; forgetting one is no longer a leak. `INSERT`s must still include `user_id` for the policy's `WITH CHECK` clause to pass. The secret-key client (`get_admin_db`) bypasses RLS and is reserved for admin paths.

---

## Pydantic ↔ DB mapping

The Pydantic models in `apps/api/app/schemas/events.py` are the single source of truth for shape validation. The mapping to Postgres is:

| Pydantic model | DB table | Notes |
|---|---|---|
| `ParentEvent` | `events` (write shape) | Used as the request body for `POST /api/events` |
| `StoredEvent` | `events` (read shape) | `ParentEvent` + `id`; returned by the API |

`action_items` is stored as `jsonb` and round-trips cleanly: Pydantic serialises `list[ActionItem]` to a list of dicts on write, and validates the list of dicts back to `list[ActionItem]` on read.

---

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/events` | Bearer JWT | Create a single event for the authenticated user |

See [BACKEND.md](BACKEND.md) for full API setup and [ADL.md](ADL.md) for architectural decisions.
