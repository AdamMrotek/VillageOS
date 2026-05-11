-- Track completion state per action item so users can tick items off in the UI.
ALTER TABLE action_items ADD COLUMN done BOOLEAN NOT NULL DEFAULT FALSE;
