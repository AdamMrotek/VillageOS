# Provider Events — Phase 2 to 4 status

Snapshot updated 2026-11-16, branch `feat/providares-pages`. Last commit
`0473ec7`; phase 4 (calendar invites) is built on top of it, uncommitted. Read
this first when picking the work back up.

**Decision (2026-11-16):** production rollout is deferred until the end of
development. Development carries on to phase 4 and D1–D3 as long as the
current work passes locally. The "To ship" and "To turn email on" sections
below are the end-of-development checklist, not the next step.

Design, phase definitions and open design questions:
[PROVIDER_EVENTS_PLAN.md](PROVIDER_EVENTS_PLAN.md).
How the built feature works: [PROVIDERS.md](../PROVIDERS.md#reservations).

## Where things stand

| Phase | State |
| --- | --- |
| 1 — Create and publish | Built and committed. |
| Role lock-down (`profiles.role`) | Built and committed (`d8f21d2`). Not yet applied to production. |
| 2 — Reserve and show on the calendar | Built, tested locally, committed and pushed (`47aa73d`). |
| 3a — In-app change propagation | Built, tested locally, committed and pushed (`47aa73d`). |
| 3b — Email notifications | Code built and committed (retry limit and dead-lettering in `48b1ae2`); tested locally with a stand-in sender. **Sending is off** and no real email has been sent. |
| 4 — Calendar invites by email | Built and tested locally (2026-11-16), not yet committed. The "done when" (real Gmail and iCloud calendars add, update and remove the event) needs SES — see "To turn email on". |
| D1–D3 Discover home | **Next.** Not started. |

Nothing from phases 2 to 4 is in production: no migration applied, no deploy.

The files these phases added or changed are in `47aa73d`
(`git show --stat 47aa73d`). Worth knowing: `apps/api/template.yaml` (worker
Lambda), `.github/workflows/ci.yml` (database tests step),
`.github/workflows/deploy-api.yml` (`EmailProvider` parameter),
`supabase/seed.sql` and `e2e/.env.e2e` (e2e provider user).

## Last verified results (local, 2026-11-16, with phase 4)

| Check | Command | Result |
| --- | --- | --- |
| API lint, format, types, tests | `cd apps/api && . .venv/bin/activate && ruff check . && ruff format --check . && mypy && pytest` | clean, 167 passed |
| Web types, lint, tests | `cd apps/web && pnpm exec tsc --noEmit && pnpm lint && pnpm test` | clean, 47 passed |
| Database rules | `bash supabase/tests/provider_events.sh` | 43 passed |
| End to end | `CI=1 pnpm --filter @repo/e2e exec playwright test` | 6 passed |

Phase 4 was also checked by hand: the worker, run against the local stack with
`EMAIL_PROVIDER=log`, sent for one reservation, in order: Booked (`REQUEST`,
`SEQUENCE` 0) → nothing while the provider's edit was inside its 10 minutes →
Updated with "Where: Sports Hall (was Pitch 1)" (`REQUEST`, 1) → parent
cancels: Reservation cancelled (`CANCEL`, 2) → reserves again: Booked
(`REQUEST`, 3) → provider cancels: Cancelled (`CANCEL`, 4). Same `UID`
throughout.

The database tests cover the "done when" conditions for phase 2 (two parents
racing for the last spot give one reservation) and the queueing half of 3b
(a burst of edits gives one pending row). The worker's sending half was checked
by hand against the local stack: three edits to two attendees sent two emails,
a reverted edit sent none, an opted-out parent was skipped.

Not verified: a real send through SES, a deploy of the new SAM template, and
the migrations against the production database.

## To ship, in this order (end of development)

Deferred on purpose: do this once phase 4 and D1–D3 are built and passing
locally, so production gets one rollout instead of several.

1. **Check CI on the pushed branch.** The E2E job also runs the database tests
   against a fresh stack, which is the first time the migrations and `seed.sql`
   are applied from scratch. (Pushed, but CI result not checked in this
   snapshot.)
2. **Apply the migrations to production before the API deploys.** Five are
   pending there: `20261114000000` (role lock-down), `20261114010000`
   (reservations), `20261114020000` (change propagation), `20261115000000`
   (outbox retry limit), `20261116000000` (calendar invites). The new API calls
   database functions that don't exist until these run; editing an event is the
   first thing that would break.
3. **Audit existing admins** after the role migration:
   `SELECT id, role, created_at FROM profiles WHERE role = 'admin';` and demote
   any that aren't recognised. The migration can't tell a self-assigned admin
   from a real one.
4. **Check the deploy role's permissions.** The template adds
   `NotificationWorkerFunction` with an EventBridge schedule rule. The deploy
   role is scoped tightly, so the deploy may fail with `AccessDenied` on the
   rule, the new function or its role. This has not been tried.
5. **Deploy.** With `EmailProvider=none` (the default) the worker runs every
   minute and does nothing. Reserving, the calendar merge and the "Updated"
   badge all work without it; parents get no calendar invites until email is
   turned on (below).

## To turn email on (phases 3b and 4, remaining; end of development)

Also deferred. SES production access can take days, so request it a little
before the rollout rather than at the very end. The sandbox test (step 3) can
run any time after the domain is verified, before the rest of the rollout.

Steps are in [INTEGRATIONS.md](../INTEGRATIONS.md#amazon-ses--calendar-invite-emails):

1. Verify `notify.villageos.co.uk` in SES (`eu-north-1`); add the DKIM CNAMEs
   in GoDaddy.
2. Check the `_dmarc` policy covers the subdomain.
3. **Phase 4's "done when", in the SES sandbox:** verify a real Gmail and a
   real iCloud address, reserve as each against the local stack, and run the
   worker locally with `EMAIL_PROVIDER=ses`. Confirm in each: the invite
   arrives and lands in the calendar (note whether Gmail adds it by itself or
   needs a click); a provider's location change updates the **same** event;
   cancelling the reservation removes it; reserving again brings it back.
   Also check the unsubscribe link. Phases 3b and 4 are not done until this
   passes.
4. Request SES production access.
5. Privacy notice: SES as a sub-processor and calendar invites (DPIA open
   item 5).
6. Set the GitHub Actions variable `EMAIL_PROVIDER=ses` and redeploy.

Outbox rows queued while sending is off stay pending. When it is switched on,
anything pending for an event that hasn't happened yet is emailed.

## Decisions still open

Tracked in one place: [PROVIDER_EVENTS_PLAN.md §3](PROVIDER_EVENTS_PLAN.md#3-open-items)
(provider vetting, attendee names, reservation cut-off, email distance limit,
title edits and calendar invites).

## Known gaps

- The email is plain text only.
- Delivery is at-least-once: a worker crash between sending and marking a row
  can repeat one email.
- The worker handles 100 rows per run and looks up each recipient one at a
  time; fine at current scale, not for a cancellation with thousands of
  attendees.
- A parent can't change their spot count from the UI without cancelling and
  reserving again (the API supports it).
- The provider side has no e2e coverage through the browser; the spec drives
  the provider through the API.
- No test covers the worker against a database in CI; its decision logic is
  unit tested and the queueing is covered by the database tests.
- No e2e test covers calendar invites: the worker isn't run in the e2e
  setup. The decisions and the invite are unit tested, the queueing is covered
  by the database tests, and the whole flow was checked by hand (above).
- Changing the spot count on a reservation doesn't send a new invite, so the
  invite's description keeps the old count.
- Only reserved provider events become invites. A parent's own events use the
  one-off "Add to Google Calendar" link, which doesn't update.

## Local environment notes

- The local Supabase database has all the provider migrations applied (the
  calendar invites one was applied by hand with `psql`), plus the
  `e2e-provider@test.local` user and its "E2E Sports Club" page. A
  `supabase db reset` recreates both from `seed.sql`; the dev provider from
  `supabase/seed_dev_provider_events.sql` must be re-applied by hand.
- The web dev server on :3000 reads `apps/web/.env.local`, which points at the
  hosted Supabase project. That project lacks the migrations, so the new
  screens fail there until step 2 above. Use the e2e setup (web :3100, API
  :8100, local stack) or point `.env.local` at `http://127.0.0.1:54321`.
- To see the emails and invites locally, set `EMAIL_PROVIDER=log` in
  `apps/api/.env` and run
  `python -c "import worker_handler; print(worker_handler.handler({}, None))"`
  from `apps/api`. A reservation's invite is due at once; a provider's edit is
  due 10 minutes after the last one (or set `due_at = NOW()` on the outbox row).

## What comes next

D1 (Discover browse page) is next; D2 (personal rows) needs reservations,
which now exist. Before starting, confirm the local checks above still pass.
Still to build before the rollout: the CloudWatch alarm on
`notification_dead`, and the worker's log events in `apps/api/LOGS.md`.
