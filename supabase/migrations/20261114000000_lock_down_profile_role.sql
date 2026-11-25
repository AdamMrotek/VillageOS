-- Close privilege escalation on profiles.role.
--
-- Two paths let any user make themselves an admin (require_admin in
-- apps/api/app/routers/admin.py trusts profiles.role):
--
--   1. handle_new_user copied `role` straight from sign-up metadata, which the
--      client controls: signUp({ options: { data: { role: 'admin' } } }).
--   2. The "users_update_own_profile" policy allowed updating any column of
--      your own row, so `UPDATE profiles SET role = 'admin'` over PostgREST
--      worked for any signed-in user.
--
-- After this migration:
--   - Sign-up can only yield 'parent' or 'provider' (provider sign-up is
--     self-serve by design; see apps/web/src/app/sign-up/page.tsx).
--   - Users can update only `full_name` on their own row.
--   - 'admin' is granted out of band, by the service role or in SQL:
--       UPDATE profiles SET role = 'admin' WHERE id = '<user id>';

-- 1. Sign-up trigger: allow-list the role instead of trusting metadata.
--    search_path is pinned because the function is SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, role, full_name)
    VALUES (
        NEW.id,
        CASE
            WHEN NEW.raw_user_meta_data->>'role' = 'provider' THEN 'provider'
            ELSE 'parent'
        END,
        NEW.raw_user_meta_data->>'full_name'
    );
    RETURN NEW;
END;
$$;

-- 2. Column-level privileges: RLS decides *which rows* a user may update, this
--    decides *which columns*. Role, id and created_at are no longer writable
--    by end users; the service role is unaffected.
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
