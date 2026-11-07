# Birthday Party Organizer: Overview

Status: design proposal (no code yet). Index of this folder:

- `00-overview.md` (this file): thesis, scope, metrics, phasing
- `01-invitations-rsvp.md`: invite and RSVP spec
- `02-venues-entertainment.md`: curated venue and entertainer directory
- `03-planner-and-ai-import.md`: party checklist, budget, AI invite import
- `04-privacy-risks.md`: child and guest data, abuse, infrastructure gaps

## Context
VillageOS turns messy parent communications into calendar events. Today nothing models guests, invitations or RSVPs. There is no outbound email beyond Supabase auth SMTP, no scheduler, and no public tokenised pages. `event_type=birthday` already exists, and `provider_profiles` is the closest fit for venues and entertainers.

## Thesis
Do not build "Eventbrite for kids' parties". Marketplaces are a cold-start trap, and Evite, Paperless Post and Punchbowl already own invites. VillageOS's edge is that it already knows the parent's calendar and the school and club context.

> Run a kid's party end to end in 10 minutes: pick a date, send an invite, get RSVPs, and have the guest list, food and cost sorted. Every guest parent's RSVP lands in their own VillageOS calendar.

The viral loop is the real product. Each invite reaches 15 to 30 parents, which is an acquisition channel for the core app.

## Scope ranking
1. Invitations and RSVP link (the wedge). See `01-invitations-rsvp.md`.
2. AI import of an invite you received. See `03-planner-and-ai-import.md`.
3. Party checklist and budget. See `03-planner-and-ai-import.md`.
4. Curated venue and entertainer directory. See `02-venues-entertainment.md`.
5. Later or maybe never: in-app booking, deposits and payments, gift registries or collection pots, native chat, a visual card designer beyond about six fixed templates.

## Phasing
- **A:** parties, invitations, RSVP, host dashboard, share and calendar add, privacy updates.
- **B:** AI invite import and the planner checklist.
- **C:** venue and entertainer directory with enquiry links.
- **D:** reminders (scheduler plus Resend), co-hosts, then evaluate booking and payments.

## Success metrics
- Invites created per active parent
- RSVP completion rate (target above 60%)
- Guests per invite
- Guest-to-signup conversion (the loop metric)
- Time from "create party" to "link shared" (under 10 minutes)
- Directory click-through and provider enquiries

## Open questions
1. Hiring-signal story (AI invite import first) or user growth (invite loop first)? This decides whether Phase A or B goes first.
2. One launch town for the directory, or UK-wide?
3. Appetite for the privacy work on child and guest data before launch?
