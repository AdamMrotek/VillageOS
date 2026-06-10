-- Providers as a user type. A provider is an auth user whose profiles.role is
-- 'provider' (the role enum + handle_new_user trigger already support this).
-- This table holds their *public* organisation details — the parent-facing
-- directory reads it, the provider owns/edits their own row.

-- Fast prefix/substring search on provider name (ILIKE '%q%').
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.provider_category AS ENUM (
    'school',
    'sports_club',
    'community',
    'council',
    'library',
    'other'
);

CREATE TABLE provider_profiles (
    user_id     UUID                  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT,
    category    public.provider_category,
    description TEXT,
    location    TEXT,
    website     TEXT,
    tags        TEXT[]                NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX provider_profiles_name_trgm ON provider_profiles USING GIN (name gin_trgm_ops);

-- RLS: the directory is public to read, but a provider may only write their own
-- row. Unlike `profiles` (owner-read-only), SELECT here is open to everyone so
-- parents can browse and view providers.
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_profiles_public_read" ON provider_profiles
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "provider_profiles_owner_insert" ON provider_profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "provider_profiles_owner_update" ON provider_profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
