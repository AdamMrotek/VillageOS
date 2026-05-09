CREATE TABLE profiles (
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT        NOT NULL DEFAULT 'parent' CHECK (role IN ('parent', 'admin', 'provider')),
    full_name   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: users manage their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own_profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Auto-create a 'parent' profile when a new user signs up.
-- Role can be overridden by passing { role: 'provider' } in sign-up metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'role', 'parent'),
        NEW.raw_user_meta_data->>'full_name'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
