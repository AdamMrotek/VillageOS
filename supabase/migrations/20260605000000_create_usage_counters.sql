-- Per-identity daily usage ledger — the cost cap behind /api/extract.
-- One counter per (user, day) for every tier (demo/free/pro). The API Gateway
-- throttle is an infra/DoS floor; this is the per-caller spend guard.
CREATE TABLE usage_counters (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    day     DATE NOT NULL DEFAULT CURRENT_DATE,
    count   INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- RLS on, but no user policy: only the service-role client (get_admin_db)
-- ever touches this table. Users have no read/write path to their own counter.
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Atomic check-and-increment in a single statement. Two concurrent Lambdas can
-- never both read N and both proceed — the upsert serializes on the PK and each
-- caller gets back a distinct post-increment count. Returns the new daily total.
CREATE OR REPLACE FUNCTION bump_usage(p_user_id UUID)
RETURNS INT
LANGUAGE sql
AS $$
    INSERT INTO usage_counters (user_id, day, count)
    VALUES (p_user_id, CURRENT_DATE, 1)
    ON CONFLICT (user_id, day)
    DO UPDATE SET count = usage_counters.count + 1
    RETURNING count;
$$;

-- Server-only: callable solely by the service role. End users (anon /
-- authenticated PostgREST roles) must never be able to move their own counter.
REVOKE EXECUTE ON FUNCTION bump_usage(UUID) FROM PUBLIC, anon, authenticated;
