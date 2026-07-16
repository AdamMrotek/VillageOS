-- E2E seed data, applied after migrations by `supabase db reset` (and by a
-- fresh `supabase start`). Local-stack-only credentials.
--
--   e2e-a@test.local / e2e-password-a  — primary user (Playwright storageState)
--   e2e-b@test.local / e2e-password-b  — counterpart for the RLS boundary spec
--
-- Users are inserted pre-confirmed so no email round-trip is needed to sign
-- in, and pre-consented (user_metadata.privacy_consent, matching what
-- app/consent writes) so login lands on /calendar instead of the consent
-- gate. The on_auth_user_created trigger creates each user's profile row.
-- GoTrue expects the token columns to be '' rather than NULL.

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
)
VALUES
    (
        '00000000-0000-0000-0000-000000000000',
        '11111111-1111-1111-1111-111111111111',
        'authenticated', 'authenticated',
        'e2e-a@test.local',
        extensions.crypt('e2e-password-a', extensions.gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}',
        '{"privacy_consent": {"version": "2026-06-16.2", "accepted_at": "2026-07-01T00:00:00Z"}}',
        now(), now(),
        '', '', '', '', ''
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '22222222-2222-2222-2222-222222222222',
        'authenticated', 'authenticated',
        'e2e-b@test.local',
        extensions.crypt('e2e-password-b', extensions.gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}',
        '{"privacy_consent": {"version": "2026-06-16.2", "accepted_at": "2026-07-01T00:00:00Z"}}',
        now(), now(),
        '', '', '', '', ''
    );

INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
)
SELECT
    gen_random_uuid(),
    u.id,
    u.id::text,
    jsonb_build_object(
        'sub', u.id::text,
        'email', u.email,
        'email_verified', true,
        'phone_verified', false
    ),
    'email',
    now(), now(), now()
FROM auth.users AS u
WHERE u.email IN ('e2e-a@test.local', 'e2e-b@test.local');
