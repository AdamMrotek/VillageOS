# Privacy and Risks

## Child and guest data (launch gate)
The feature collects other parents' names and contact details, children's names, and allergy information (health-adjacent). Before launch:
- Update `DPIA.md` and `DATA_PROTECTION_CHECKLIST.md`.
- Show a guest-facing privacy notice on the invite and RSVP pages.
- Collect the minimum: first names for children where possible, a single contact field per guest.
- Contact details are visible to the host only.
- Retention: auto-delete guest data a fixed period after the party (for example 30 days).
- Guest self-service: cancelling through the manage link also offers "delete my details".

## Public endpoint abuse
The RSVP routes are the first unauthenticated write path in the app.
- Unguessable tokens (at least 128 bits), separate tokens for party and RSVP
- Rate limiting per IP and per token, bot check
- Strict validation and length limits
- Service-role access (`get_admin_db`) confined to one narrow router, with tests for cross-party isolation

## Infrastructure gaps
- **No scheduler:** the SAM template defines no scheduled events. Reminders and host nudges need an EventBridge scheduled Lambda. Deferred to Phase D.
- **No application email:** Resend is wired only as Supabase auth SMTP. v1 avoids email by sharing links through WhatsApp. Reminders would use Resend (domain already verified).
- **No push, SMS or WhatsApp sending.**

## Marketplace cold start
Mitigated by the curated, single-geography approach in `02-venues-entertainment.md`.

## Household model
Everything is per-`user_id` today. Parties work on that. Co-hosting (a partner) will push toward a household entity. Defer it, but do not design it out: keep `parties.user_id` as the owner and avoid assumptions that block adding collaborators later.

## Out of scope for v1
Payments, collection pots and gift registries (regulatory and payments burden), in-app chat, email invites.
