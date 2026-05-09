-- Add urgent flag to action items
ALTER TABLE action_items ADD COLUMN urgent BOOLEAN NOT NULL DEFAULT FALSE;

-- Add user ownership to events.
-- Nullable so existing dev rows are unaffected; the API always supplies user_id.
ALTER TABLE events ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- RLS on events: users only see their own rows
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_events" ON events
    FOR ALL
    USING  (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RLS on action_items: inherit access from parent event
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_action_items" ON action_items
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM events
            WHERE events.id = action_items.event_id
              AND events.user_id = auth.uid()
        )
    );
