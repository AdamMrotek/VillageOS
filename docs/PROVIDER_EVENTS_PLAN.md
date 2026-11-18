# Provider Events & Reservations — Plan and Design

This document is the design and the phase definitions. Current build state, the
ship checklist and known gaps live in
[PROVIDER_EVENTS_STATUS.md](PROVIDER_EVENTS_STATUS.md) and are not repeated
here. Where the build differs from this design, the difference is listed under
[2.1](#21-what-was-built-differently). Open design questions are in
[section 3](#3-open-items).

Providers create and publish events; parents discover them, reserve a spot, get
the event into their own calendar app, and stay up to date when the provider
edits or cancels it.

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
2. **Keeping their calendar app current** (Google / Apple / Outlook).

One email does both: it says what changed and carries the calendar update.

### 1.2 External calendars: calendar invites by email

Reserving a spot emails the parent a **calendar invite** (iCalendar
`METHOD:REQUEST`, sent as email per RFC 6047). Gmail, Apple Mail and Outlook
show it with an "Add to calendar" control, and Gmail usually adds it on its own.
When the provider changes the time, place or status, or the parent cancels, the
parent is emailed an update to the **same** invite, and their calendar app
changes the event it already holds.

- **The event stays the same event.** Every invite for a reservation carries
  the same `UID`, and a `SEQUENCE` that goes up with each one sent. Calendar
  apps apply an invite only when its `SEQUENCE` is above the last they saw.
- **Removal** is `METHOD:CANCEL` with the same `UID`: for a provider
  cancellation and for a reservation the parent cancelled. (In VillageOS a
  cancelled event stays on the calendar, struck through; the calendar app
  removes it or marks it cancelled, depending on the app.)
- **The organiser is the sender.** Gmail only applies updates from the
  invite's `ORGANIZER`, so it is the from-address,
  `events@notify.villageos.co.uk`. Invites are sent as already accepted with
  `RSVP=FALSE`: nothing reads replies.
- No OAuth scope, no token storage, no Google API verification, nothing hosted
  for a calendar app to fetch. Works with any mail client that understands
  iCalendar.
- **Fast:** an invite goes out within a minute of reserving; an update within
  about ten minutes of the provider's last edit (1.5.1).
- **Trade-offs:** one-way (edits made in the calendar app don't come back); a
  parent who turns these emails off gets no invites and no updates; title and
  description edits don't send an update (see section 3).

The existing link-based "Add to Google Calendar" export
(`apps/web/src/lib/utils/calendar-export.ts`) stays as a one-off for a parent's
own events. A real Google API sync is deferred (Phase 5). Decision record:
ADR-026.

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
| `invite_sequence` | `SEQUENCE` for the next calendar invite; +1 per invite sent, never reset |
| `invite_version` | The event `version` the parent's calendar was last sent; `NULL` = nothing in their calendar |
| `created_at` | Timestamp |

Unique on `(event_id, user_id)`.

RLS:

- Parents read and cancel their own reservations.
- Providers read reservations for their own events.
- No direct `INSERT` — reservations are only created through `reserve_spot`.

### 1.4 Reserving a spot

A Postgres function `reserve_spot(event_id, spots)`:

1. Locks the `provider_events` row (`SELECT … FOR UPDATE`).
2. Rejects if the event is not `published` or is in the past.
3. Sums confirmed `spots`; rejects if `capacity` would be exceeded.
4. Inserts (or re-confirms) the reservation with `seen_version = version`.
5. Queues the calendar invite (an outbox row, due at once; see 1.5.1).

`cancel_reservation(event_id)` likewise queues the invite's withdrawal.

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
- **Email with a calendar update (only when it matters):** see 1.5.1.

#### 1.5.1 Calendar invite emails: outbox + debounce

Each reservation gets these emails, each carrying a calendar invite:

| Email | When | Invite |
| --- | --- | --- |
| Booked | The parent reserves | `REQUEST` |
| Updated | Time or location changed | `REQUEST`, next `SEQUENCE` |
| Cancelled | The provider cancelled | `CANCEL` |
| Reservation cancelled | The parent cancelled, after the invite went out | `CANCEL` |

An update or cancellation is sent only when all of these hold:

- The provider left "Notify attendees" ticked on the edit form (default on).
  Unticked, the calendar app catches up on the next notified change.
- The parent has not turned these emails off in settings.
- The state after the quiet period still differs from what the parent's
  calendar was last sent (an edit that is reverted sends nothing).

Mechanism — a **transactional outbox**:

1. The change and its `notification_outbox` row are written in the same
   database transaction, so a notification is never lost and never sent for a
   change that rolled back: `reserve_spot()` and `cancel_reservation()` queue a
   row due at once; a provider's material edit queues one per confirmed
   reservation, due 10 minutes later. If a pending row already exists for that
   reservation, it is updated (and its due time moved) instead of duplicated.
2. A scheduled worker Lambda (EventBridge, every minute) picks up due rows.
3. The worker **reconciles** rather than replays: it compares what the
   parent's calendar was last sent (`reservations.invite_version`) with what it
   should show now, sends at most **one** email to close the gap, records the
   new `invite_version` and `invite_sequence`, and marks the row sent.
4. Failed rows stay pending and retry on the next run, up to 25 tries (about 25
   minutes). After that the row is dead-lettered: set to `failed` with the last
   error, and left in the table for someone to look at.

`notification_outbox`:

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK |
| `reservation_id` | FK → `reservations(id)` `ON DELETE CASCADE` |
| `event_id` | FK → `provider_events(id)` |
| `status` | `pending` \| `sent` \| `skipped` \| `failed` (dead-lettered) |
| `due_at` | When the worker may handle it: at once for a reservation change, 10 minutes after the last edit for a provider change |
| `pending_since`, `sent_at` | Timestamps; `pending_since` resets each time the row is queued again |
| `attempts`, `last_error`, `failed_at` | Failed tries so far, the latest error, and when the row was dead-lettered |

At most one `pending` row per reservation (partial unique index), which is what
makes sends idempotent. RLS: no user access; the worker uses the secret-key
client.

This replaces the earlier "send inline, move to SQS later" idea. A queue
delivers each message as soon as it can, which is the opposite of coalescing;
the outbox gives debounce, retries and idempotency with one table and one
small Lambda.

**Sending provider: Amazon SES**, called from the worker with `boto3`, behind a
small `send_email` interface so the provider can be swapped. The email is sent
as raw MIME (`text/plain` and `text/calendar; method=…` as alternatives, plus
the invite as an `invite.ics` attachment), since SES's simple format can't
carry a calendar part. Resend stays as
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

`GET /api/events` returns the merged list. Each item carries
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
- Calendar invites put the event details into the parent's own mailbox and
  calendar app (their provider, not our processor), sent through SES: covered
  by the SES entry in the DPIA, plus a line in the privacy notice.

---

## 2. Phases

### Phase 1 — Provider events: create and publish

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

### 2.1 What was built differently

- **Providers can't read reservations.** 1.3 gave providers `SELECT` on
  reservations for their own events. Built without it: a provider gets the
  count of spots taken from a function, not the rows. Attendee names (1.7)
  need consent copy and a DPIA entry first.
- **Version history table.** `provider_event_versions` keeps the material
  fields at each superseded version. Both the in-app "what changed" line and
  the email diff read it; 1.5 did not say where the old values would come from.
- **Change tracking is a database trigger**, not API code, so it also holds for
  writes that go straight to PostgREST. `version` only moves once an event has
  left draft.
- **"Notify attendees" travels through `update_provider_event()`**, which sets
  a transaction-local flag the trigger reads.
- **Guards added:** an event with reservations can't be unpublished (it would
  vanish from calendars — cancel it instead); capacity can't drop below the
  spots reserved; a cancelled event can't be changed.

### Phase 4 — Calendar invites by email

Builds on 3b: same outbox, worker and SES sender.

- Migration: `invite_sequence` and `invite_version` on `reservations`;
  `due_at` on the outbox; `reserve_spot()` and `cancel_reservation()` queue a
  row.
- API: iCalendar invite builder (`REQUEST` / `CANCEL`, stable `UID`,
  `SEQUENCE`, organiser = sender); raw MIME email with the calendar part; the
  worker reconciles each reservation's calendar (1.5.1) and runs every minute.
- UI: Reserve copy says an invite is coming; the Settings email toggle says
  that turning it off stops calendar updates; the provider's "Notify
  attendees" copy says it updates calendars.
- Docs: DPIA, INTEGRATIONS.md, PROVIDERS.md, new ADR.
- **Done when:** a real Gmail and a real iCloud address each receive the
  invite on reserving, see the same event update in place when the provider
  moves it, and lose it when the reservation is cancelled. Testable in the SES
  sandbox (verified recipients), before production access.

### Phase 5 — Later

Waitlists, recurring provider events, per-child reservations, payments, and a
real two-way Google Calendar API sync.

---

## 3. Open items

- ~~**Role assignment.**~~ Closed by
  `supabase/migrations/20261114000000_lock_down_profile_role.sql`: sign-up can
  only yield `parent` or `provider`, and users can no longer update
  `profiles.role` on their own row. `admin` is granted out of band.
- **Provider vetting.** Provider sign-up is self-serve, so `provider` is not a
  vetted role, and the provider tables' RLS checks ownership, not role: any
  signed-in user can create a provider page and publish events.
- **Attendee names for providers.** Built as a count only (see 2.1). Showing
  names needs consent copy on the Reserve button and a DPIA entry (DPIA open
  item 6).
- Should emails be limited to events starting soon (for example within 14
  days), with distant changes left to the in-app badge? (Assumed: no limit for
  now.)
- **Title and description edits** don't bump `version`, so they send no
  invite update and the calendar app keeps the old title. Should a title
  change count as material? It would also show the "Updated" badge and send an
  email. (Assumed: no, for now.)
- Reservation cut-off: can a parent reserve or cancel right up to start time?
  (Assumed: yes.)

---

## 4. Discover home — browse and recommendations

Status: D1 **built** (2026-11-17); D2 and D3 not started. A separate track from
sections 1–3; it depends on Phase 1 for event content. How the built page
works: [PROVIDERS.md](../PROVIDERS.md#discover).

A streaming-app style browse page for parents: horizontal rows of cards they
can scroll through, instead of today's single search grid.

### 4.1 Content types

| Type | What it is | Card leads to | Backed by |
| --- | --- | --- | --- |
| **Venue** | A place families go: soft play, pool, library, club ground | Provider page with its upcoming events | `provider_profiles`, `kind = 'venue'` |
| **Entertainer** | A person or act that is booked: magician, face painter, party host | Provider page with an enquiry contact | `provider_profiles`, `kind = 'entertainer'` |
| **Event** | A dated thing with spots | The provider's page, scrolled to the event, with Reserve | `provider_events` |

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

`GET /api/discover/home?kind=` returns the featured item and an ordered list
of rows for the selected kind chip:

```json
{
  "featured": { "item_type": "event", "item": {} },
  "rows": [
    { "id": "events-this-week", "title": "This week", "item_type": "event", "items": [] },
    { "id": "popular-venues", "title": "Popular venues", "item_type": "provider", "items": [] }
  ]
}
```

The frontend renders whatever it is given. New rows, reordering and
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

**D1 — Browse page with rule-based rows** (after Phase 1) — **built**

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
