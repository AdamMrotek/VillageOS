-- Local-dev seed for the provider events pages. NOT part of `supabase db reset`
-- (config.toml only loads seed.sql, which the e2e suite depends on). Apply with:
--
--   docker exec -i supabase_db_VillageOS psql -U postgres < supabase/seed_dev_provider_events.sql
--
-- Idempotent: re-running replaces the provider's events. Dates are relative to
-- now() so the data is always upcoming.
--
--   provider@dev.local / dev-password  — provider with a profile + 8 events
--   (log in against the LOCAL stack: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321)

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'provider@dev.local',
    extensions.crypt('dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"role": "provider", "full_name": "Oakfield Primary", "privacy_consent": {"version": "2026-06-16.2", "accepted_at": "2026-07-01T00:00:00Z"}}',
    now(), now(),
    '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email,
                          'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
FROM auth.users AS u
WHERE u.id = '33333333-3333-3333-3333-333333333333'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);

INSERT INTO provider_profiles (user_id, name, category, description, location, website, tags)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'Oakfield Primary School',
    'school',
    'A friendly village primary school. Events and notices for parents.',
    'Oakfield Lane, Millbrook',
    'https://example.com/oakfield',
    ARRAY['school', 'primary']
)
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM provider_events WHERE provider_id = '33333333-3333-3333-3333-333333333333';

INSERT INTO provider_events
    (provider_id, title, event_type, start_time, end_time, is_all_day, location, description, capacity, status)
VALUES
    -- Published, upcoming
    ('33333333-3333-3333-3333-333333333333', 'Autumn Fair', 'fundraiser',
     date_trunc('day', now()) + interval '5 days 10 hours', date_trunc('day', now()) + interval '5 days 14 hours',
     false, 'School field', 'Stalls, games and cake. All proceeds fund the library refit.', NULL, 'published'),
    ('33333333-3333-3333-3333-333333333333', 'Parents'' Evening: Year 3', 'meeting',
     date_trunc('day', now()) + interval '9 days 15 hours', date_trunc('day', now()) + interval '9 days 18 hours',
     false, 'Classroom 3B', '10-minute slots with the class teacher.', 18, 'published'),
    ('33333333-3333-3333-3333-333333333333', 'Inter-school Football Tournament', 'sport',
     date_trunc('day', now()) + interval '12 days 9 hours', date_trunc('day', now()) + interval '12 days 15 hours',
     false, 'Millbrook Rec Ground', 'Year 5 & 6 teams. Bring a water bottle and shin pads.', 40, 'published'),
    ('33333333-3333-3333-3333-333333333333', 'INSET Day — School Closed', 'school',
     date_trunc('day', now()) + interval '16 days', NULL,
     true, NULL, 'Staff training day. No pupils in school.', NULL, 'published'),
    ('33333333-3333-3333-3333-333333333333', 'Reception Starter Pack Deadline', 'deadline',
     date_trunc('day', now()) + interval '20 days 17 hours', NULL,
     false, 'School office', 'Return forms and uniform order.', NULL, 'published'),
    -- Drafts
    ('33333333-3333-3333-3333-333333333333', 'Christmas Concert', 'school',
     date_trunc('day', now()) + interval '40 days 18 hours', date_trunc('day', now()) + interval '40 days 20 hours',
     false, 'Main hall', 'Draft — waiting on hall booking.', 120, 'draft'),
    ('33333333-3333-3333-3333-333333333333', 'Bake Sale', 'fundraiser',
     date_trunc('day', now()) + interval '25 days 15 hours', NULL,
     false, 'Playground', NULL, NULL, 'draft'),
    -- Cancelled
    ('33333333-3333-3333-3333-333333333333', 'Sports Day', 'sport',
     date_trunc('day', now()) + interval '3 days 9 hours', date_trunc('day', now()) + interval '3 days 15 hours',
     false, 'School field', 'Cancelled due to ground conditions. New date to follow.', NULL, 'cancelled');
