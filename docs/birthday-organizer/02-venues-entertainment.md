# Venues and Entertainment Directory

## Position
A curated directory, not a marketplace. Marketplaces fail on cold start, so v1 validates demand with listings and enquiries before any booking, availability or payments.

## Build on what exists
`provider_profiles` already has name, category, description, location, website, image, tags, public read, owner-only write, and pg_trgm search. `/discover` and `/provider` pages exist. Extend rather than create a new entity.

Additions:
- New categories: venue, entertainer, cake, soft_play
- Fields: capacity, price band, age range, contact or enquiry URL
- Filters on `/discover`: category, age range, capacity, price band

## Cold-start strategy
- Hand-seed 20 to 30 listings in one town.
- Providers can claim and edit their own listing through the existing provider role.
- Judge demand by directory click-through and enquiries before building more.

## Enquiry flow (v1)
A mailto link or simple form. No in-app booking, no deposits, no chat.

## Link to parties
From a party, "Find a venue" and "Find entertainment" open `/discover` pre-filtered, and the chosen listing attaches to the party's location and checklist.

## Monetisation (later)
Featured listings or paid leads from providers. This is the only revenue path with real upside here.

## Not in scope
Availability calendars, payments, reviews, provider messaging.

## Open question
One launch town, or UK-wide?
