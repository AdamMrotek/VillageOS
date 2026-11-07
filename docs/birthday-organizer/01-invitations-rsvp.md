# Invitations and RSVP

## Decision
**One open link per party, a private manage link per RSVP, and host controls.** No guest emails are collected.

## Flow
1. Host creates a party (child name, age, date and time, location, notes) and picks a card template. The party is linked 1:1 to an `events` row with `event_type='birthday'`.
2. Host gets a public link `/invite/[token]` and shares it via WhatsApp, SMS or copy-link. A WhatsApp share button matters most for UK parents.
3. Guest parent opens the link with no account and submits: parent name, contact (phone or email, visible to the host only), each child attending, staying or dropping off, and allergies. One submission covers a whole family, so there are no per-child invites.
4. On submit the guest gets a private manage link `/rsvp/[rsvp-token]`. It is shown on the confirmation page, saved in localStorage, and copyable. Through it they can edit children, switch yes/no, or cancel. Cancelling updates the host dashboard immediately.
5. After RSVP the guest sees "Add to calendar" (reuse `apps/web/src/lib/utils/calendar-export.ts`) and a VillageOS signup prompt. This is the growth loop.

The RSVP token is separate from the party token, so the open link never grants edit access.

## Host controls
- Close RSVPs
- Set a cap on attendees
- Remove any entry
- Optional "approve each RSVP" mode
- Rotate the party link (invalidates the old one)

## Host dashboard
Headcount, dietary summary, pending approvals, cancellations.

## Abuse protection
- Unguessable tokens (at least 128 bits)
- Rate limiting per IP and per token
- Bot check (honeypot or Turnstile)
- Input validation and length limits on every field
- The public write path uses `get_admin_db` (service role), isolated to one narrow router

## Known limit
An open link cannot show who has not replied. Upgrade paths, only if hosts ask:
1. **Class list:** the host pastes class names (no emails) and the dashboard ticks them off.
2. **Personal links per family (v2 design):** the host pastes a name list, the app generates one link per family, and each is sent via WhatsApp. The link is also the edit credential, cannot usefully be forwarded, and gives exact non-responder tracking.

Email invites are out of v1: they need guest emails, extra privacy work, and a sender and scheduler we do not have.

## Data model (migration in `supabase/migrations/`)
- `parties`: id, user_id, event_id, child_name, child_age, theme, notes, rsvp_status (open/closed), cap, require_approval
- `invitations`: id, party_id, token, rotated_at
- `rsvps`: id, party_id, token, parent_name, contact, status (yes/no/maybe/cancelled/pending), staying_or_dropoff, dietary, created_at, updated_at
- `rsvp_children`: id, rsvp_id, child_name

RLS: the host owns everything (`auth.uid() = user_id` through the party). Anonymous writes happen only through the public API route.

## API and web
- `apps/api/app/routers/parties.py`: authenticated host CRUD, dashboard, controls
- `apps/api/app/routers/rsvp.py`: public, rate-limited; create, read and update by token
- Schemas in `apps/api/app/schemas/`
- Public pages: `apps/web/src/app/invite/[token]/page.tsx` and `apps/web/src/app/rsvp/[token]/page.tsx`. Add both to `alwaysAllowed` in `apps/web/src/proxy-rules.ts`, with a unit test.
- Host views under the `(app)/parties` route group; TanStack Query hooks in `apps/web/src/lib/queries/`
- Cover images: reuse `apps/api/app/services/provider_media.py` (S3 presigned upload, CloudFront)

## Verification
- Unit tests: `proxy-rules` allow-list, token generation, RSVP schema validation
- API tests: valid and invalid token, rate limit, RLS cross-host isolation, party token cannot edit an RSVP
- Playwright (`e2e/`): host creates a party, a logged-out guest RSVPs, edits, then cancels; the host sees each change
