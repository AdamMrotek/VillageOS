-- Retry limit and dead-lettering for the notification outbox.
--
-- Until now a row that failed stayed pending and was retried every run, with
-- no limit. A row that can never succeed (a bad address, say) was retried
-- forever, and because the worker takes the oldest rows first, enough of them
-- would hold up newer ones.
--
-- The worker now counts attempts and, after the limit, moves the row to
-- 'failed'. Failed rows are the dead letters: they stay in this table with the
-- last error, out of the worker's way, until someone looks at them.
--
--   SELECT id, event_id, attempts, last_error, failed_at
--   FROM notification_outbox WHERE status = 'failed' ORDER BY failed_at DESC;

ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'failed';

ALTER TABLE notification_outbox
    -- Sends that raised. Reaching the worker's limit moves the row to 'failed'.
    ADD COLUMN attempts   INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN last_error TEXT,
    ADD COLUMN failed_at  TIMESTAMPTZ;
