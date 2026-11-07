# Party Planner and AI Invite Import

## Party planner checklist and budget
Reuse the existing `action_items` table (description, `cost_estimate_gbp`, done, urgent).
- Checklist templates by child age: food, cake, goody bags, helpers, timeline.
- Running cost total across items.
- Items attach to the party's event, so they show in the existing prep list.

## AI import of a received invite
A guest parent pastes a WhatsApp invite or uploads a photo and gets a party event they can RSVP to or just track, plus a gift and prep checklist.

Reuse the extraction pipeline:
- `apps/api/app/services/extraction.py` (instructor with Pydantic) and versioned prompts in `apps/api/app/prompts/extraction/` (v3 already has a birthday rule requiring "birthday" or "turning N")
- Vision path for photos (`v3_vision`, ADR-018)
- Frontend review-before-save flow in `apps/web/src/components/extraction/`

New work:
- A prompt version that also captures RSVP deadline, RSVP contact, and dress or bring-along notes
- A new golden set in `apps/api/tests/golden/`, extending existing cases `03_birthday_party` and `05_birthday_pizza`, covering text and image invites, plus invites with ambiguous dates and multiple contacts
- Eval runs through `apps/api/evals/extraction/` (see `apps/api/EVALS.md`) before any prompt change ships

## Why this matters
It is cheap, it works for guests who never use the host side, and it is the strongest AI-engineering proof in the feature: a measured extraction task with a golden dataset.
