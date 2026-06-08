# Providers

Providers are organisations (schools, sports clubs, councils, libraries, community groups) that parents can discover in VillageOS. A provider is an ordinary auth user whose `profiles.role` is `provider`; the `provider_profiles` table holds the **public** organisation details they publish, and the parent-facing directory reads from it.

Three surfaces make up the feature:

| Surface | Route | Who | What |
| --- | --- | --- | --- |
| **My provider page** | `/provider` | the provider (owner) | create / edit their own public profile + cover image |
| **Discover** | `/discover` | anyone signed in | search the directory of providers |
| **Provider detail** | `/discover/[providerId]` | anyone signed in | read a single provider's public page |

## Data model

`provider_profiles` (migration `20260608000000_create_provider_profiles.sql`, image column added in `20260608010000_add_provider_image.sql`):

| Column | Notes |
| --- | --- |
| `user_id` | PK, FK → `auth.users(id)` `ON DELETE CASCADE`. One profile per user. |
| `name` | Organisation name (≤120 chars, validated in the API). |
| `category` | `provider_category` enum: `school`, `sports_club`, `community`, `council`, `library`, `other`. |
| `description` | ≤600 chars. |
| `location`, `website` | Free text. |
| `image_url` | Full CloudFront URL of the cover image (nullable). |
| `tags` | `TEXT[]`, defaults `{}`. |
| `created_at`, `updated_at` | Timestamps. |

There is a trigram GIN index on `name` (`pg_trgm`) backing case-insensitive `ILIKE '%q%'` search.

### Row-level security

The directory is **public-read, owner-write**:

- `SELECT` — open to `anon` + `authenticated` (`USING (true)`), so parents can browse and view any provider.
- `INSERT` / `UPDATE` — only the owner: `auth.uid() = user_id`. This is why `upsert_my_provider` sets `user_id` explicitly from the verified JWT — the RLS `WITH CHECK` requires it to match `auth.uid()`.

## Creating / editing a provider page

`/provider` (`apps/web/src/app/(app)/provider/page.tsx`) loads the signed-in user's own profile via `useMyProvider()` (`GET /api/providers/me`, returns `null` until one exists), then renders `ProviderForm` seeded from it. The form is a single upsert — there's no separate "create" vs "edit":

1. The provider fills in name, category, description, location, website, tags, and drops a cover image.
2. Submit → `useUpdateMyProvider()` → `PUT /api/providers/me` with the full `ProviderProfileInput`.
3. The API's `upsert_my_provider` stamps `user_id` (from the JWT) + `updated_at` and upserts the row.
4. On success the mutation writes the result into the `my-provider` cache and invalidates the `providers` (directory) cache so search results reflect the change.

### Cover image upload (presigned S3 → CloudFront)

Cover bytes never pass through Lambda / API Gateway. The flow (`CoverDropzone` → `uploadProviderCover` → `POST /api/providers/me/cover-upload-url`):

1. The browser asks the API for an upload ticket, sending the file's MIME type.
2. `provider_media.create_cover_upload_ticket` (auth-gated) returns a **presigned S3 POST** for a versioned key `providers/{user_sub}/cover-{uuid}.{ext}`, plus the final `image_url` (CloudFront URL) and `max_bytes`.
3. The browser POSTs the file straight to S3 with the signed policy fields (file appended **last**, as S3 requires).
4. On success the returned `image_url` is set on the form and persisted with the next profile save.

Why it's built this way:

- **Presigned POST, not PUT** — the signed policy carries a `content-length-range` condition and a fixed `Content-Type`, so S3 itself rejects oversized (>5 MB) or wrong-type uploads; the client can't tamper with the limits.
- **Versioned keys** — a replacement gets a new URL, so CloudFront never serves a stale image and no cache invalidation is ever needed.
- **Private bucket + CloudFront OAC** — the S3 bucket is fully private; only CloudFront (via Origin Access Control) can read it. The Lambda's IAM only grants `s3:PutObject`.
- Accepted types: PNG, JPEG, WebP. Cap: 5 MB (enforced client-side as a pre-check **and** by the S3 policy).

## Search (Discover)

`/discover` (`apps/web/src/app/(app)/discover/page.tsx`) is a debounced (250 ms) search box over the directory:

- `useProviders(q)` → `GET /api/providers?q=<query>` (empty query returns the full list, ordered by name).
- Server side, `search_providers` does a case-insensitive substring match on `name` (`ILIKE '%q%'`), backed by the trigram index.
- Results render as a responsive grid of `ProviderCard`s.

## Detail pages

`/discover/[providerId]` (`apps/web/src/app/(app)/discover/[providerId]/page.tsx`) reads one provider via `useProvider(userId)` → `GET /api/providers/{user_id}` (public, returns 404 if missing). It shows the details (location, description, website, tags) with the cover image beside them on desktop (`md:flex-row`) and below them on mobile.

## Category styling

Providers share a colour language with calendar events. `apps/web/src/lib/provider-styles.ts` mirrors `event-styles.ts` (same `dot` / `bg` / `border` shape and palette); where a category lines up with an event type the colour matches on purpose (`school` → event blue, `sports_club` → `accent`). `ProviderCard` applies the per-category **3px left accent border** (same treatment events use in the week grid). The `CategoryBadge` is a neutral pill with the label only — deliberately no colour dot, which would read as an availability/status light.

## API reference

All under `apps/api/app/routers/providers.py`, prefix `/api/providers`:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `` (`?q=`) | public | Search the directory by name. |
| `GET` | `/me` | required | The caller's own profile (`null` if none). |
| `PUT` | `/me` | required | Create or update the caller's profile. |
| `POST` | `/me/cover-upload-url` | required | Get a presigned S3 POST for a cover image. |
| `GET` | `/{user_id}` | public | A single provider's public profile. |

> `/me` and `/me/cover-upload-url` are declared **before** `/{user_id}` so `me` isn't captured as a path param.

## Key files

```
apps/api/app/routers/providers.py        # endpoints
apps/api/app/services/providers.py       # search / get / upsert
apps/api/app/services/provider_media.py  # presigned cover-upload tickets
apps/api/app/schemas/providers.py        # Pydantic models + validation
apps/api/template.yaml                   # ProviderCover* S3 bucket, OAC, CloudFront
supabase/migrations/2026060800000*.sql   # table, RLS, image column

apps/web/src/app/(app)/provider/page.tsx            # owner edit form
apps/web/src/app/(app)/discover/page.tsx            # search
apps/web/src/app/(app)/discover/[providerId]/page.tsx  # detail
apps/web/src/components/provider-card.tsx           # card + CategoryBadge
apps/web/src/components/cover-dropzone.tsx           # drag/drop uploader
apps/web/src/lib/queries/providers.ts               # React Query hooks + upload
apps/web/src/lib/provider-styles.ts                 # per-category colours
apps/web/src/lib/types/providers.ts                 # shared TS types
```

## Configuration

The cover-image pipeline needs these (created by the SAM stack — read them from `sam deploy` outputs):

| Var | Where | Notes |
| --- | --- | --- |
| `PROVIDER_COVER_BUCKET` | API env | Private S3 bucket for cover uploads. |
| `PROVIDER_COVER_CDN_DOMAIN` | API env | CloudFront domain that serves covers. |
| `COVER_CORS_ORIGINS` | GitHub repo variable → `CoverCorsOrigins` param | Browser origins allowed to POST straight to S3 (kept separate from the API's `ALLOWED_ORIGINS`). |

The web app also pins the CloudFront host in `apps/web/next.config.ts` (`images.remotePatterns`) so `next/image` will serve the covers.
