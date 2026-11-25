-- Local-dev seed for the Discover page: venues, entertainers and a sports club
-- with upcoming events, so the browse rows have something to show. NOT part of
-- `supabase db reset` (config.toml only loads seed.sql). Apply with:
--
--   docker exec -i supabase_db_VillageOS psql -U postgres < supabase/seed_dev_discover.sql
--
-- Pairs well with seed_dev_provider_events.sql (Oakfield Primary School).
-- Idempotent: re-running refreshes the profiles and replaces their events.
-- Dates are relative to now() so the events are always upcoming. These
-- providers never sign in (no password, no identity).

INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
)
SELECT '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated',
       email, now(), '{"provider": "email", "providers": ["email"]}', '{"role": "provider"}',
       now(), now(), '', '', '', '', ''
FROM (VALUES
    ('44444444-0000-4000-8000-000000000001', 'leisure@dev.local'),
    ('44444444-0000-4000-8000-000000000002', 'softplay@dev.local'),
    ('44444444-0000-4000-8000-000000000003', 'library@dev.local'),
    ('44444444-0000-4000-8000-000000000004', 'football@dev.local'),
    ('44444444-0000-4000-8000-000000000005', 'magician@dev.local'),
    ('44444444-0000-4000-8000-000000000006', 'facepaint@dev.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO provider_profiles (user_id, name, category, kind, description, location, tags)
VALUES
    ('44444444-0000-4000-8000-000000000001', 'Millbrook Leisure Centre', 'council', 'venue',
     'Pool, sports hall and climbing wall. Family swim sessions every weekend.',
     'Station Road, Millbrook', ARRAY['swimming', 'indoor']),
    ('44444444-0000-4000-8000-000000000002', 'Jungle Jim''s Soft Play', 'other', 'venue',
     'Three-level soft play with a separate under-5s area and café.',
     'Unit 4, Mill Lane Trading Estate', ARRAY['soft play', 'under-5s']),
    ('44444444-0000-4000-8000-000000000003', 'Millbrook Library', 'library', 'venue',
     'Rhyme Time, Lego Club and the summer reading challenge.',
     'High Street, Millbrook', ARRAY['books', 'free']),
    ('44444444-0000-4000-8000-000000000004', 'Riverside Juniors FC', 'sports_club', 'organiser',
     'Grassroots football for ages 5 to 12. Tasters welcome.',
     'Riverside Rec Ground', ARRAY['football', 'ages-5-12']),
    ('44444444-0000-4000-8000-000000000005', 'Marvo the Magician', 'other', 'entertainer',
     'Close-up magic, balloon modelling and a disappearing rabbit. Parties for ages 4 to 10.',
     'Covers Millbrook and nearby villages', ARRAY['parties', 'magic']),
    ('44444444-0000-4000-8000-000000000006', 'Face Paint Fairy', 'other', 'entertainer',
     'Face painting and glitter tattoos for parties and fêtes.',
     'Millbrook', ARRAY['parties', 'face painting'])
ON CONFLICT (user_id) DO UPDATE
SET name = EXCLUDED.name, category = EXCLUDED.category, kind = EXCLUDED.kind,
    description = EXCLUDED.description, location = EXCLUDED.location, tags = EXCLUDED.tags;

DELETE FROM provider_events WHERE provider_id::text LIKE '44444444-0000-4000-8000-%';

INSERT INTO provider_events
    (provider_id, title, event_type, start_time, end_time, is_all_day, location, description, capacity, status)
VALUES
    ('44444444-0000-4000-8000-000000000001', 'Family Swim', 'sport',
     date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 12 hours',
     false, 'Main pool', 'Inflatables out. Under-8s with an adult in the water.', 40, 'published'),
    ('44444444-0000-4000-8000-000000000001', 'Toddler Splash', 'sport',
     date_trunc('day', now()) + interval '4 days 9 hours 30 minutes', date_trunc('day', now()) + interval '4 days 10 hours 15 minutes',
     false, 'Learner pool', 'Songs and splashing for under-3s.', 12, 'published'),
    ('44444444-0000-4000-8000-000000000001', 'Climbing Taster', 'sport',
     date_trunc('day', now()) + interval '11 days 14 hours', date_trunc('day', now()) + interval '11 days 15 hours',
     false, 'Climbing wall', 'Ages 7 and up. Harnesses provided.', 8, 'published'),
    ('44444444-0000-4000-8000-000000000002', 'Under-5s Morning', 'other',
     date_trunc('day', now()) + interval '3 days 9 hours', date_trunc('day', now()) + interval '3 days 12 hours',
     false, NULL, 'Quiet session for little ones. Big kids'' area closed.', 25, 'published'),
    ('44444444-0000-4000-8000-000000000003', 'Rhyme Time', 'other',
     date_trunc('day', now()) + interval '1 day 10 hours', date_trunc('day', now()) + interval '1 day 10 hours 30 minutes',
     false, 'Children''s corner', 'Songs and rhymes for babies and toddlers. Free.', 20, 'published'),
    ('44444444-0000-4000-8000-000000000003', 'Lego Club', 'other',
     date_trunc('day', now()) + interval '6 days 15 hours 30 minutes', date_trunc('day', now()) + interval '6 days 16 hours 30 minutes',
     false, 'Community room', 'Build to this week''s theme. Ages 5 to 11.', 16, 'published'),
    ('44444444-0000-4000-8000-000000000004', 'U8 Football Taster', 'sport',
     date_trunc('day', now()) + interval '5 days 10 hours', date_trunc('day', now()) + interval '5 days 11 hours',
     false, 'Pitch 2', 'Free taster session. Bring shin pads and a drink.', 20, 'published'),
    ('44444444-0000-4000-8000-000000000004', 'Holiday Football Camp', 'sport',
     date_trunc('day', now()) + interval '18 days 9 hours', date_trunc('day', now()) + interval '18 days 15 hours',
     false, 'Riverside Rec Ground', 'Full day of coaching and matches. Ages 6 to 12.', 30, 'published');
