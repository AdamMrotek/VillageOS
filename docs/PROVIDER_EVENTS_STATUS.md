# Provider Events — Phase 2 and 3 status

Snapshot taken 2026-11-14, branch `feat/providares-pages`, last commit
`d8f21d2` (role migration). Read this first when picking the work back up.

Design and phase definitions: [PROVIDER_EVENTS_PLAN.md](PROVIDER_EVENTS_PLAN.md).
How the built feature works: [PROVIDERS.md](../PROVIDERS.md#reservations).

## Where things stand

| Phase | State |
| --- | --- |
| 1 — Create and publish | Built and committed. |
| Role lock-down (`profiles.role`) | Built and committed (`d8f21d2`). Not yet applied to production. |
| 2 — Reserve and show on the calendar | Built and tested locally. **Not committed.** |
| 3a — In-app change propagation | Built and tested locally. **Not committed.** |
| 3b — Email notifications | Code built and tested locally with a stand-in sender. **Not committed. Sending is off** and no real email has been sent. |
| 4 — ICS feed, D1–D3 Discover home | Not started. |

Nothing from phases 2 or 3 is in production: no migration applied, no deploy.

## Uncommitted work

About 53 changed files in the working tree, 17 of them new. The new ones:

```
supabase/migrations/20261114010000_create_reservations.sql
supabase/migrations/20261114020000_provider_event_change_propagation.sql
supabase/tests/provider_events.sh
apps/api/app/routers/reservations.py
apps/api/app/schemas/reservations.py
apps/api/app/services/reservations.py
apps/api/app/services/notifications.py
apps/api/app/services/email.py
apps/api/app/services/db_errors.py
apps/api/worker_handler.py
apps/api/tests/test_reservations.py
apps/api/tests/test_notifications.py
apps/web/src/components/reserve-action.tsx
apps/web/src/lib/queries/preferences.ts
apps/web/src/lib/utils/event-changes.ts
apps/web/src/lib/utils/event-changes.test.ts
e2e/tests/reservations.spec.ts
```

Modified files worth knowing about: `apps/api/template.yaml` (worker Lambda),
`.github/workflows/ci.yml` (database tests step), `.github/workflows/deploy-api.yml`
(`EmailProvider` parameter), `supabase/seed.sql` and `e2e/.env.e2e` (e2e
provider user), `packages/ui/src/custom_components/account-settings.tsx`
(children slot), plus the docs.

**First step when resuming: commit this.** It has not been pushed, so CI has
not run on it.

## Last verified results (local, 2026-11-14)

| Check | Command | Result |
| --- | --- | --- |
| API lint, format, types, tests | `cd apps/api && ruff check . && ruff format --check . && mypy && pytest` | clean, 136 passed |
| Web types, lint, tests | `cd apps/web && pnpm exec tsc --noEmit && pnpm lint && pnpm test` | clean, 47 passed |
| Database rules | `bash supabase/tests/provider_events.sh` | 39 passed |
| End to end | `CI=1 pnpm --filter @repo/e2e exec playwright test` | 6 passed |

The database tests cover the "done when" conditions for phase 2 (two parents
racing for the last spot give one reservation) and the queueing half of 3b
(a burst of edits gives one pending row). The worker's sending half was checked
by hand against the local stack: three edits to two attendees sent two emails,
a reverted edit sent none, an opted-out parent was skipped.

Not verified: a real send through SES, a deploy of the new SAM template, and
the migrations against the production database.

## To ship, in this order

1. **Commit and push**, and let CI run. The E2E job now also runs the database
   tests against a fresh stack, which is the first time the migrations and
   `seed.sql` will be applied from scratch.
2. **Apply the migrations to production before the API deploys.** Three are
   pending there: `20261114000000` (role lock-down), `20261114010000`
   (reservations), `20261114020000` (change propagation). The new API calls
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
5. **Deploy.** With `EmailProvider=none` (the default) the worker runs and does
   nothing. Reserving, the calendar merge and the "Updated" badge all work
   without it.

## To turn email on (phase 3b, remaining)

Steps are in [INTEGRATIONS.md](../INTEGRATIONS.md#amazon-ses--event-change-emails):

1. Verify `notify.villageos.co.uk` in SES (`eu-north-1`); add the DKIM CNAMEs
   in GoDaddy.
2. Request SES production access.
3. Check the `_dmarc` policy covers the subdomain.
4. Add Amazon SES to the privacy notice's sub-processor list (DPIA open item 5).
5. Set the GitHub Actions variable `EMAIL_PROVIDER=ses` and redeploy.
6. Send one real change email end to end and confirm it arrives with a working
   unsubscribe link. Phase 3b is not done until this passes.

Outbox rows queued while sending is off stay pending. When it is switched on,
anything pending for an event that hasn't happened yet is emailed.

## Decisions still open

- **Provider vetting.** `provider` is self-serve at sign-up, and the provider
  tables' RLS checks ownership, not role, so any signed-in user can create a
  provider page and publish events.
- **Attendee names for providers.** Built as count only. Showing names needs
  consent copy on the Reserve button and a DPIA entry (DPIA open item 6).
- From the plan, still on their assumed defaults: no cut-off for reserving or
  cancelling before the start; emails sent however far away the event is.

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

## Local environment notes

- The local Supabase database has all three migrations applied, plus the
  `e2e-provider@test.local` user and its "E2E Sports Club" page. A
  `supabase db reset` recreates both from `seed.sql`; the dev provider from
  `supabase/seed_dev_provider_events.sql` must be re-applied by hand.
- The web dev server on :3000 reads `apps/web/.env.local`, which points at the
  hosted Supabase project. That project lacks the migrations, so the new
  screens fail there until step 2 above. Use the e2e setup (web :3100, API
  :8100, local stack) or point `.env.local` at `http://127.0.0.1:54321`.
- To see change emails locally, set `EMAIL_PROVIDER=log` in `apps/api/.env`
  and run `python -c "import worker_handler; print(worker_handler.handler({}, None))"`
  from `apps/api`. Rows only become due 10 minutes after the last edit.

## What comes after

Phase 4 (ICS feed) and D1 (Discover browse page) are both unblocked. D2
(personal rows) needs reservations, which now exist.
