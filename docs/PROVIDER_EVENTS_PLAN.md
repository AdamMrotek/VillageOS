# Provider Events & Reservations — Plan and Design

Status: **Phase 1 built** (2026-11-13); everything else is proposed.

Providers create and publish events; parents discover them, reserve a spot, see
the event on their calendar, and stay up to date when the provider edits or
cancels it.

Builds on the existing provider feature ([PROVIDERS.md](../PROVIDERS.md)): the
`provider_profiles` table, `/provider`, `/discover`, `/discover/[providerId]`.

---

## 1. Design

### 1.1 Core decision: reference, don't copy

A reserved event is **not** copied into the parent's `events` table. A
`reservations` row points at the provider's event, and the parent's calendar
reads *own events + reserved provider events* live.

| | Copy into `events` | Reference via `reservations` (chosen) |
| --- | --- | --- |
| Provider edits | Need a fan-out job to rewrite every copy | Visible on next fetch, no job |
| Parent edits the copy | Diverges from the source, conflict rules needed | Not possible; provider events are read-only |
| Cancellation | Copies must be found and marked | One status change on the source row |
| Cost | Simple calendar query | Calendar query becomes a merge of two sources |

With references, the "update system" shrinks to two jobs:

1. **Telling parents something changed** (in-app badge + email).
2. **Keeping external calendars current** (Google / Apple / Outlook).

### 1.2 External calendars: ICS subscription feed, not the Google Calendar API

Each parent gets one tokenised feed URL (`webcal://…/feed/{token}.ics`) that
they subscribe to once.

- No OAuth scope, no token storage, no Google API verification.
- Works for Apple and Outlook as well as Google.
- Updates propagate in place because each event has a stable `UID` and a
  `SEQUENCE` that increases with every material edit.
- **Trade-off:** Google polls subscribed feeds roughly every 12–24h. In-app and
  email are the fast channel; the feed is the eventually-consistent one.

The existing link-based "Add to Google Calendar" export
(`apps/web/src/lib/utils/calendar-export.ts`) stays as a one-off for a parent's
own events. A real Google API sync is deferred (Phase 5).

### 1.3 Data model

#### `provider_events`

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK |
| `provider_id` | FK → `provider_profiles(user_id)` `ON DELETE CASCADE` |
| `title`, `event_type`, `start_time`, `end_time`, `is_all_day`, `location`, `description` | Same shape and validation as `events` |
| `capacity` | `int`, nullable = unlimited |
| `status` | `draft` \| `published` \| `cancelled` |
| `version` | `int`, starts at 1; bumped on material edits (see 1.5) |
| `created_at`, `updated_at` | Timestamps |

RLS:

- `SELECT` — anyone, where `status IN ('published', 'cancelled')`; the owner
  also sees their own drafts.
- `INSERT` / `UPDATE` / `DELETE` — owner only (`auth.uid() = provider_id`).
- Delete is only allowed while `draft`. Published events are cancelled, never
  deleted, so parents see a cancelled event rather than a vanished one.

#### `reservations`

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK |
| `event_id` | FK → `provider_events(id)` |
| `user_id` | FK → `auth.users(id)` `ON DELETE CASCADE` |
| `spots` | `int`, default 1 |
| `status` | `confirmed` \| `cancelled` |
| `seen_version` | The event `version` the parent last acknowledged |
| `created_at` | Timestamp |

Unique on `(event_id, user_id)`.

RLS:

- Parents read and cancel their own reservations.
- Providers read reservations for their own events.
- No direct `INSERT` — reservations are only created through `reserve_spot`.

#### `calendar_feed_tokens` (Phase 4)

| Column | Notes |
| --- | --- |
| `user_id` | PK, FK → `auth.users(id)` `ON DELETE CASCADE` |
| `token` | Random, unguessable, unique; regenerating it revokes the old URL |
| `created_at` | Timestamp |

### 1.4 Reserving a spot

A Postgres function `reserve_spot(event_id, spots)`:

1. Locks the `provider_events` row (`SELECT … FOR UPDATE`).
2. Rejects if the event is not `published` or is in the past.
3. Sums confirmed `spots`; rejects if `capacity` would be exceeded.
4. Inserts (or re-confirms) the reservation with `seen_version = version`.

Capacity must be enforced in the database. A check in the API layer cannot
prevent two parents racing for the last spot.

### 1.5 Change propagation

Small providers edit often and in bursts, so the design aims to send far fewer
emails than there are edits.

- **Material fields:** `start_time`, `end_time`, `is_all_day`, `location`,
  `status`. An edit to any of these bumps `version`. Title or description edits
  do not.
- **In-app (every material change):** where
  `reservation.seen_version < event.version`, the calendar shows an "Updated"
  badge and the detail sheet shows what changed. Opening the sheet sets
  `seen_version = version`.
- **Cancellation:** the provider sets `status = 'cancelled'`. The event stays on
  parents' calendars, struck through.
- **ICS feed:** `SEQUENCE` = `version`; cancelled events emit
  `STATUS:CANCELLED`.
- **Email (only when it matters):** see 1.5.1.

#### 1.5.1 Email notifications: outbox + debounce

Email is sent only for cancellations and time or location changes, and only
when all of these hold:

- The provider left "Notify attendees" ticked on the edit form (default on).
- The parent has not turned event emails off in settings.
- The state after the quiet period still differs from what the parent last
  saw (an edit that is reverted sends nothing).

Mechanism — a **transactional outbox**:

1. The provider's edit and the `notification_outbox` rows (one per confirmed
   reservation) are written in the same database transaction, so a notification
   is never lost and never sent for an edit that rolled back. If a pending row
   already exists for that reservation, it is updated instead of duplicated.
2. A scheduled worker Lambda (EventBridge, every 5 minutes) picks up pending
   rows whose event has been quiet for 10+ minutes.
3. It sends **one** email per parent, diffing the version the parent was last
   notified about against the current state, then marks the row sent.
4. Failed rows stay pending and retry on the next run.

`notification_outbox`:

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK |
| `reservation_id` | FK → `reservations(id)` `ON DELETE CASCADE` |
| `event_id` | FK → `provider_events(id)` |
| `from_version` | Version the parent was last emailed about (or reserved at) |
| `status` | `pending` \| `sent` \| `skipped` |
| `pending_since`, `sent_at` | Timestamps; `pending_since` resets on each new edit |

At most one `pending` row per reservation (partial unique index), which is what
makes sends idempotent. RLS: no user access; the worker uses the secret-key
client.

This replaces the earlier "send inline, move to SQS later" idea. A queue
delivers each message as soon as it can, which is the opposite of coalescing;
the outbox gives debounce, retries and idempotency with one table and one
small Lambda.

**Sending provider: Amazon SES**, called from the worker with `boto3`, behind a
small `send_email` interface so the provider can be swapped. Resend stays as
Supabase's SMTP for auth emails only. Reasons: SES has no monthly fee and costs
roughly $0.10 per 1,000 emails, while Resend's free tier has a 100/day cap that
a single large cancellation would exceed (prices from memory — verify before
committing).

**Sending domain: `notify.villageos.co.uk`**, a dedicated subdomain for event
notifications. Mailbox providers track reputation per sending domain, so
bounces or spam complaints on notification mail stay off the domain that
carries sign-up and password-reset emails (`noreply@villageos.co.uk` via
Resend's `send.` subdomain). From address: `events@notify.villageos.co.uk`.

Setup: verify `notify.villageos.co.uk` in SES (DKIM CNAMEs, plus SPF/MX for a
custom MAIL FROM, all added in the GoDaddy DNS panel), request production
access (leaving the sandbox takes about a day), grant the worker
`ses:SendEmail` scoped to that identity. Check that the existing `_dmarc`
policy, if one is set, covers the subdomain.

Every email carries an unsubscribe link to the notification setting.

### 1.6 Calendar merge

`GET /api/events` returns the merged feed. Each item carries
`source: "own" | "provider"`. Provider-sourced items also carry the provider id
and name, the reservation id, and an `updated` flag. In the UI they are
read-only, with "Cancel reservation" and a link to the provider page.

### 1.7 Assumed defaults

- Reservations are instant — no provider approval step.
- One reservation per parent per event, with a `spots` count rather than named
  children.
- Providers see attendee names and counts only.

### 1.8 Data protection

- Showing a parent's name to a provider is new data sharing: add a DPIA entry
  and consent copy on the Reserve button.
- The ICS feed is an unauthenticated URL that carries family calendar data: the
  token must be unguessable and revocable, and the feed needs a DPIA entry.

---

## 2. Phases

### Phase 1 — Provider events: create and publish (built)

- Migration: `provider_events` table + RLS.
- API: `/api/providers/me/events` CRUD, publish / unpublish;
  public `GET /api/providers/{id}/events`.
- UI: `/provider/events` list and form (reuse the `calendar/new` form pieces);
  "Upcoming events" section on `/discover/[providerId]`.
- **Done when:** a provider publishes an event and a parent sees it on the
  provider's page.

### Phase 2 — Reserve and show on the calendar

- Migration: `reservations` table + RLS + `reserve_spot` function.
- API: reserve, cancel reservation; merged `GET /api/events`.
- UI: Reserve button with spots-left / full states; provider-sourced events in
  the week grid and detail sheet; attendee count on the provider side.
- **Done when:** two parents racing for the last spot produce exactly one
  reservation, and the reserved event shows in the week grid.

### Phase 3 — Change propagation

Split in two so the in-app half ships without waiting on SES approval.

**3a — In-app**

- `version` bump on material edits; cancel-not-delete for published events.
- "Updated" badge, what-changed line, acknowledge on open.
- **Done when:** a provider moves the time and the parent sees the badge.

**3b — Email**

- Migration: `notification_outbox`; event-email preference on the parent.
- "Notify attendees" checkbox on the provider edit form.
- Worker Lambda + EventBridge schedule in `apps/api/template.yaml`.
- SES verification of `notify.villageos.co.uk` (DNS records in GoDaddy),
  production access, IAM permission; `send_email` interface.
- Docs: INTEGRATIONS.md (SES + new DNS records), DPIA (SES as a processor).
- **Done when:** a provider saves three edits within a few minutes and each
  attending parent receives exactly one email; an edit that is reverted sends
  none.

### Phase 4 — External calendar sync (ICS feed)

- Migration: `calendar_feed_tokens`.
- API: public `GET /api/calendar/feed/{token}.ics` with stable `UID`,
  `SEQUENCE`, `STATUS:CANCELLED`.
- UI: Settings section "Subscribe in Google / Apple Calendar" with
  regenerate-link.
- Docs: DPIA, INTEGRATIONS.md, PROVIDERS.md, new ADR.
- **Done when:** a subscribed Google Calendar reflects a provider edit without
  the parent doing anything.

### Phase 5 — Later

Waitlists, recurring provider events, per-child reservations, payments, and a
real two-way Google Calendar API sync.

---

## 3. Open items

- ~~**Role assignment.**~~ Closed by
  `supabase/migrations/20261114000000_lock_down_profile_role.sql`: sign-up can
  only yield `parent` or `provider`, and users can no longer update
  `profiles.role` on their own row. `admin` is granted out of band. Provider
  sign-up stays self-serve, so `provider` is not a vetted role.
- Should emails be limited to events starting soon (for example within 14
  days), with distant changes left to the in-app badge? (Assumed: no limit for
  now.)
- Should own events be included in the ICS feed, or only reserved provider
  events? (Assumed: both.)
- Reservation cut-off: can a parent reserve or cancel right up to start time?
  (Assumed: yes.)

---

## 4. Discover home — browse and recommendations

Status: **proposed** (2026-11-13). A separate track from sections 1–3; it
depends on Phase 1 for event content.

A streaming-app style browse page for parents: horizontal rows of cards they
can scroll through, instead of today's single search grid.

### 4.1 Content types

| Type | What it is | Card leads to | Backed by |
| --- | --- | --- | --- |
| **Venue** | A place families go: soft play, pool, library, club ground | Provider page with its upcoming events | `provider_profiles`, `kind = 'venue'` |
| **Entertainer** | A person or act that is booked: magician, face painter, party host | Provider page with an enquiry contact | `provider_profiles`, `kind = 'entertainer'` |
| **Event** | A dated thing with spots | Event detail with Reserve | `provider_events` |

Model change: add `kind` (`venue` \| `organiser` \| `entertainer`, default
`organiser`) to `provider_profiles`. It is separate from the existing
`category` enum: `category` says what sector a provider is in, `kind` says how
parents use them. Schools and councils are `organiser`.

Entertainers are **listing only** in this track. They are booked for private
parties rather than publishing public events, so a booking/enquiry flow is a
different feature and is deferred.

### 4.2 Page

The browse page replaces `/discover` as the landing view. Search stays at the
top; typing a query switches to the existing results grid.

Layout, top to bottom:

1. Search box and kind filter chips (All / Events / Venues / Entertainers).
2. One featured item (large card).
3. Rows, each a horizontally scrolling strip of cards with a title.

Cards reuse `ProviderCard` styling and the per-category accent colours. Event
cards show date, spots left and the provider name.

### 4.3 Rows are server-driven

`GET /api/discover/home` returns an ordered list of rows:

```json
[
  { "id": "events-this-week", "title": "This week", "item_type": "event", "items": [] },
  { "id": "popular-venues", "title": "Popular venues", "item_type": "provider", "items": [] }
]
```

The frontend renders whatever rows it is given. New rows, reordering and
personalisation are then API-only changes, and empty rows are dropped
server-side.

### 4.4 Recommendation stages

Start with rules; add personalisation only once there is behaviour to learn
from.

| Stage | Rows | Signal |
| --- | --- | --- |
| **R1 — Rules** | This week · New on VillageOS · Popular venues · Entertainers · one row per category | Start date, `created_at`, confirmed reservation counts |
| **R2 — Personal rules** | Because you reserved X · More from providers you've used · Fits your calendar (no clash with existing events) | The parent's reservations and own calendar |
| **R3 — Embeddings** | Recommended for you | pgvector: embed provider and event text; a per-parent taste vector averaged from reserved events and own calendar events; rank by similarity, filter by date and capacity |

Every recommended row filters out past events, full events and events the
parent has already reserved.

### 4.5 Gaps this exposes

- **Location.** `provider_profiles.location` is free text, so "near you" is
  not possible yet. It needs a structured field (postcode → lat/long) on
  providers and a home area for the parent. Left out of R1; listed as an open
  item.
- **Age suitability.** Add optional `age_min` / `age_max` to `provider_events`
  so rows can be filtered by age. Filtering needs an age band from the parent,
  which is children's data: store the minimum (a band, not a birth date) and
  add a DPIA entry before building it.
- **Cold start.** With few providers the page looks empty. R1 rows fall back
  to "All events" / "All providers" when there is too little content to fill
  themed rows.
- **Personalisation is profiling** under UK GDPR. R2 and R3 need a line in the
  privacy notice and DPIA.

### 4.6 Phases

**D1 — Browse page with rule-based rows** (after Phase 1)

- Migration: `kind` on `provider_profiles`; kind selector on the provider form.
- API: `GET /api/discover/home` with R1 rows.
- UI: row/carousel components, event card, featured card, kind chips; search
  falls through to the existing grid.
- **Done when:** a parent lands on the page and sees at least three populated
  rows mixing events, venues and entertainers.

**D2 — Personal rows** (after Phase 2, needs reservations)

- R2 rows; privacy notice + DPIA update.
- **Done when:** after reserving a football event, the parent sees a
  "Because you reserved…" row.

**D3 — Embedding recommendations**

- pgvector extension, embedding columns, embed-on-publish, taste vector, the
  "Recommended for you" row, and an offline eval set to check ranking quality.
- **Done when:** the row beats the "Popular" row on the eval set.

**Later:** location and "near you", age filtering, entertainer enquiries.
