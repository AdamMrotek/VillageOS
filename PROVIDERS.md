# Providers

Providers are organisations (schools, sports clubs, councils, libraries, community groups) that parents can discover in VillageOS. A provider is an ordinary auth user whose `profiles.role` is `provider`; the `provider_profiles` table holds the **public** organisation details they publish, and the parent-facing directory reads from it.

Four surfaces make up the feature:

| Surface | Route | Who | What |
| --- | --- | --- | --- |
| **My provider page** | `/provider` | the provider (owner) | create / edit their own public profile + cover image |
| **Discover** | `/discover` | anyone signed in | search the directory of providers |
| **Provider detail** | `/discover/[providerId]` | anyone signed in | read a single provider's public page and its upcoming events |
| **My events** | `/provider/events` | the provider (owner) | create, edit, publish, unpublish and cancel events |

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

## Provider events

Phases 1–3 of [docs/PROVIDER_EVENTS_PLAN.md](docs/PROVIDER_EVENTS_PLAN.md): a
provider creates events and publishes them to their public page; parents
reserve spots and see the event on their calendar; when the provider changes or
cancels it, parents are told in the app and by email. See
[Reservations](#reservations) and [Change propagation](#change-propagation).

### Data model

`provider_events` (migration `20261113000000_create_provider_events.sql`):

| Column | Notes |
| --- | --- |
| `id` | PK. |
| `provider_id` | FK → `provider_profiles(user_id)` `ON DELETE CASCADE`. An event needs a provider page to appear on. |
| `title`, `event_type`, `start_time`, `end_time`, `is_all_day`, `location`, `description` | Same shape and limits as `events` (title ≤60, description ≤240, end after start). Shared in the API through `EventCore`. |
| `capacity` | Positive integer, or `NULL` for unlimited. Enforced by `reserve_spot()`; can't be lowered below the spots already reserved. |
| `status` | `provider_event_status` enum: `draft`, `published`, `cancelled`. |
| `version` | Starts at 1. Owned by the change-tracking trigger: bumped on each material edit after publishing; a client can't set it. |

It is a separate table from `events` on purpose: `events` rows are private to
one parent, these are public once published.

### Row-level security

- `SELECT` — anyone for `published` and `cancelled` rows; the owner also reads
  their own drafts.
- `INSERT` / `UPDATE` — owner only (`auth.uid() = provider_id`).
- `DELETE` — owner only, and only while `draft`.

Because published rows are public, "my events" must filter on `provider_id`
explicitly, and the public listing filters on status explicitly so a provider
viewing their own public page sees what parents see.

### Status rules

| From | Action | To |
| --- | --- | --- |
| `draft` | publish (start must not be more than a day in the past) | `published` |
| `published` | unpublish (refused once parents have reserved) | `draft` |
| `published` | cancel | `cancelled` (terminal, not editable) |
| `draft` | delete | row removed |

A published event is cancelled rather than deleted, so parents see a
cancellation instead of the event disappearing. Each transition is a single
conditional `UPDATE` (the expected current status is part of the `WHERE`), so
racing requests can't both succeed. A wrong-state request returns `409` with a
message the UI shows as-is.

The public listing returns events that started up to one day ago, which keeps
in-progress and all-day events visible without knowing the viewer's timezone.

### Pages

- `/provider/events` — the provider's events as cards with a status badge and
  the actions valid for that status. Cancelling asks for a second click.
  Without a provider page it links to `/provider` instead.
- `/provider/events/new`, `/provider/events/[eventId]` — `ProviderEventForm`.
  The edit page reads the event from the cached list.
- `/discover/[providerId]` — an "Upcoming events" section of `ProviderEventCard`s,
  each with `ReserveAction` (spots picker + Reserve, or "You have N spots
  reserved" + Cancel).

## Reservations

A reserved event is **not copied** into the parent's `events` table. A
`reservations` row points at the provider's event and the calendar reads both
sources live, so a provider's edit is visible on the next fetch.

`reservations` (migration `20261114010000_create_reservations.sql`):

| Column | Notes |
| --- | --- |
| `event_id`, `user_id` | Unique together: one reservation per parent per event. |
| `spots` | 1–10. |
| `status` | `confirmed` or `cancelled`. Cancelling keeps the row; reserving again re-confirms it. |
| `seen_version` | The event `version` the parent last acknowledged. |
| `invite_sequence`, `invite_version` | The parent's calendar invite: the `SEQUENCE` the next one carries, and the event version their calendar was last sent (`NULL` = nothing in it). Written by the worker only. See [Calendar invites](#calendar-invites). |

**Capacity is enforced in the database.** `reserve_spot(event_id, spots)` locks
the event row, sums the confirmed spots and inserts only if there is room, so
two parents racing for the last spot produce exactly one reservation. An API
check could not guarantee that.

**Access.** A parent reads their own reservations and nothing else. All writes
go through `reserve_spot()`, `cancel_reservation()` and
`mark_reservation_seen()`; direct `INSERT`/`UPDATE` is revoked, because it would
bypass the capacity check. A provider sees **how many** spots are taken
(`provider_event_spots_taken()`), not who took them — showing attendees needs
consent copy and a DPIA entry first.

**Calendar.** `GET /api/events` returns the parent's own events merged with
their reserved ones. Each item has `source: "own" | "provider"`; reserved items
also carry `reservation` (provider id and name, spots, `cancelled`, `updated`,
and `previous` — the state the parent last saw). They are read-only in the UI.

Demo (anonymous) sessions can't reserve.

## Change propagation

Migration `20261114020000_provider_event_change_propagation.sql`. One trigger on
`provider_events` does everything that must happen when an event changes, in
the same transaction as the edit:

1. **Version.** A *material* edit — `start_time`, `end_time`, `is_all_day`,
   `location`, `status` — to an event that has left draft bumps `version`.
   Title, description and capacity edits don't.
2. **History.** The pre-edit values are kept in `provider_event_versions`, so a
   parent can be shown what changed.
3. **Outbox.** One `notification_outbox` row per confirmed reservation, due 10
   minutes later, unless the provider unticked "Notify attendees". A
   reservation has at most one pending row, so a burst of edits coalesces.
   `reserve_spot()` and `cancel_reservation()` queue a row too, due at once
   (migration `20261116000000_calendar_invites.sql`).

It also refuses to change a cancelled event, to unpublish an event with
reservations, or to drop capacity below the spots reserved.

**In the app.** While `reservation.seen_version < event.version` the calendar
chip shows "Updated" (or "Cancelled", struck through). Opening the event shows
what changed and acknowledges it.

**By email, into their calendar app.** See [Notifications](#notifications).

## Notifications

Emails to parents about events they reserved. The database queues the work;
a scheduled worker sends it.

**Queue.** `notification_outbox`: at most one pending row per reservation,
meaning "this reservation may need an email". Rows are written by the database
in the same transaction as the change: `reserve_spot()` and
`cancel_reservation()` queue one due at once; a provider's material edit queues
one per confirmed reservation, due 10 minutes after their last edit (see
[Change propagation](#change-propagation)). A row holds no email: the worker
decides what to send when the row is due, from the state at that moment, so a
burst of edits becomes one email and a reverted edit none.

**Worker.** A Lambda (`worker_handler.py`, EventBridge, every minute) runs
`app/notifications/worker.py`. For each due row it resolves the recipient (the
reservation's owner, if they haven't turned these emails off in Settings →
Notifications), asks the row's **handler** what to send, sends it, records the
result and closes the row.

| Module (`apps/api/app/notifications/`) | Does |
| --- | --- |
| `worker.py` | The loop, and `HANDLERS`: which handler each kind of row goes to |
| `outbox.py` | Every database read and write: due rows, recipient, record a send, close a row, count a failure |
| `calendar_sync.py` | Handler for calendar invites ([below](#calendar-invites)) |
| `messages.py` | The wording of every email |
| `types.py` | `Context`, `Recipient`, `Decision` (what a handler returns) |

The invite text is `app/services/ics.py`; sending is `app/services/email.py`
(`EMAIL_PROVIDER`: `none` | `log` | `ses`). It is `none` in production until
SES is verified — see [INTEGRATIONS.md](INTEGRATIONS.md#amazon-ses--calendar-invite-emails).
With `log`, each email and its invite are written to the log (local
development).

**Delivery** is at-least-once: a crash between sending and recording can repeat
an email (a repeated invite carries the same `SEQUENCE`, which calendar apps
treat as the same update). A row that fails is retried on later runs; after 25
tries it is dead-lettered (`status = 'failed'`, with `last_error`) and logged
as `notification_dead`. If the database itself is unreachable the run stops and
everything stays pending for the next one. To see the dead letters:
`SELECT id, event_id, attempts, last_error, failed_at FROM notification_outbox WHERE status = 'failed';`

### Calendar invites

Reserving emails the parent a calendar invite; a provider's change, or the
parent cancelling, emails an update to that same invite, which their calendar
app (Google, Apple, Outlook) applies to the event it already holds. Design:
[PROVIDER_EVENTS_PLAN.md §1.2 and §1.5.1](docs/PROVIDER_EVENTS_PLAN.md#12-external-calendars-calendar-invites-by-email);
decision: ADR-026.

`calendar_sync.py` compares what the parent's calendar was last sent
(`reservations.invite_version`) with what it should show now, and picks at most
one email:

| Situation | Email (`reason` in the log) | Invite |
| --- | --- | --- |
| Confirmed, nothing sent yet | Booked (`booked`) | `REQUEST` |
| Time or place changed since the last invite | Updated (`updated`), listing what changed | `REQUEST` |
| Provider cancelled | Cancelled (`cancelled`) | `CANCEL` |
| Parent cancelled, an invite was sent | Reservation cancelled (`withdrawn`) | `CANCEL` |

Nothing is sent (`reason`) when the calendar is already current
(`up_to_date`), an edit was reverted (`reverted`), the parent cancelled before
the invite went out (`not_in_calendar`), the event was cancelled before it did
(`cancelled_before_invite`), the event is more than a day past (`event_past`),
or the parent turned these emails off (`opted_out`). After a send the
reservation records the new `invite_version` and `invite_sequence + 1`.

**The invite.** `UID` is `reservation-{reservation id}@villageos.co.uk`, the
same for every invite on that reservation, including after cancelling and
reserving again. `SEQUENCE` is `invite_sequence`. `ORGANIZER` is the
from-address (`EMAIL_FROM`), because Gmail only applies updates from the
organiser; the parent is an `ATTENDEE` already accepted, with `RSVP=FALSE`.
All-day events are written as `VALUE=DATE` on their UK date
(`app/core/local_time.py`). The email (`to_mime` in `app/services/email.py`)
carries it twice: as a `text/calendar; method=…` alternative to the text body,
which Gmail and Outlook act on, and as an `invite.ics` attachment.

### Adding a notification

**Another email in the invite flow** (e.g. resend the invite when the spot
count changes):

1. `messages.py`: add a `Kind` and its wording in `calendar_email()`.
2. `calendar_sync.py`: add the rule in `decide()` that picks it.
3. If something new should queue a row, queue it in the database function or
   trigger that makes the change, in the same transaction.
4. Tests in `tests/test_notifications.py`; queueing in
   `supabase/tests/provider_events.sh`.

**A different notification about a reservation** (e.g. a reminder the day
before):

1. The first time only: add a `kind` column to `notification_outbox`
   (default `'calendar'`), select it in `outbox._SELECT`, and include `kind` in
   the one-pending-row-per-reservation index so kinds don't overwrite each
   other.
2. A handler module next to `calendar_sync.py` with
   `handle(db, row, recipient, ctx) -> Decision`, kept pure where it can be
   (`decide()` plus a thin `handle()` that loads what it needs through
   `outbox.py`).
3. Register it in `worker.HANDLERS` under its kind.
4. Its wording in `messages.py`.
5. Something that queues it: a database function or trigger, or for
   time-based ones, a scheduled step that inserts due rows.

Retries, dead-lettering, the email opt-out and the unsubscribe header come
from the worker and sender without further work. A notification to someone
other than the reservation's owner (e.g. the provider) also needs
`outbox.recipient()` to know who to look up.

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

Events, in `apps/api/app/routers/provider_events.py` (same prefix):

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/me/events` | required | The caller's events, drafts included. |
| `POST` | `/me/events` | required | Create a draft (`409` without a provider page). |
| `PUT` | `/me/events/{event_id}` | required | Edit a draft or published event. `notify_attendees` (default `true`) controls the email that updates parents' calendar invites. |
| `POST` | `/me/events/{event_id}/publish` · `/unpublish` · `/cancel` | required | Change status. |
| `DELETE` | `/me/events/{event_id}` | required | Delete a draft. |
| `GET` | `/{provider_id}/events` | required | A provider's upcoming published and cancelled events. |

Both listings include `spots_taken` and the caller's own `my_spots`.

Reservations, in `apps/api/app/routers/reservations.py`, prefix `/api/provider-events`:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PUT` | `/{event_id}/reservation` | required | Reserve, re-confirm or change the spot count (`409` when full). |
| `DELETE` | `/{event_id}/reservation` | required | Cancel the caller's reservation. |
| `POST` | `/{event_id}/reservation/seen` | required | Acknowledge the provider's latest change. |

`GET` / `PUT /api/account/preferences` reads and sets `event_emails` (calendar
invites and their updates).

> `/me` and `/me/cover-upload-url` are declared **before** `/{user_id}` so `me` isn't captured as a path param.

## Key files

```
apps/api/app/routers/providers.py        # endpoints
apps/api/app/services/providers.py       # search / get / upsert
apps/api/app/services/provider_media.py  # presigned cover-upload tickets
apps/api/app/schemas/providers.py        # Pydantic models + validation
apps/api/app/routers/provider_events.py  # event endpoints
apps/api/app/services/provider_events.py # event CRUD + status transitions
apps/api/app/schemas/provider_events.py  # ProviderEventInput (extends EventCore)
apps/api/tests/test_provider_events.py   # schema + service rules
apps/api/app/services/reservations.py    # reserve / cancel / calendar merge
apps/api/app/notifications/              # outbox worker + handlers (see Notifications)
apps/api/app/services/ics.py             # calendar invite (UID, SEQUENCE, folding)
apps/api/app/services/email.py           # send_email interface (log / SES), MIME
apps/api/app/services/db_errors.py       # database rule violations → HTTP errors
apps/api/worker_handler.py               # Lambda entry point for the worker
supabase/tests/provider_events.sh        # DB tests: race, RLS, trigger, outbox queueing
e2e/tests/reservations.spec.ts           # reserve → updated → cancelled, in a browser
apps/api/template.yaml                   # ProviderCover* S3 bucket, OAC, CloudFront
supabase/migrations/2026060800000*.sql   # table, RLS, image column

apps/web/src/app/(app)/provider/page.tsx            # owner edit form
apps/web/src/app/(app)/discover/page.tsx            # search
apps/web/src/app/(app)/discover/[providerId]/page.tsx  # detail
apps/web/src/app/(app)/provider/events/             # owner list, new, edit
apps/web/src/components/provider-card.tsx           # card + CategoryBadge
apps/web/src/components/provider-event-card.tsx     # event card + status badge
apps/web/src/components/provider-event-form.tsx     # create / edit form
apps/web/src/lib/queries/provider-events.ts         # event React Query hooks
apps/web/src/lib/types/provider-events.ts           # event TS types
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
