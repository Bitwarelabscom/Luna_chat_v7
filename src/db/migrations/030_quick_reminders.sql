-- Quick reminders table for "remind me in X minutes" feature
CREATE TABLE IF NOT EXISTS quick_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ DEFAULT NULL
);

-- Index for efficient lookup of pending reminders
CREATE INDEX IF NOT EXISTS idx_quick_reminders_pending
    ON quick_reminders(remind_at)
    WHERE delivered_at IS NULL;

-- Index for user's reminders
CREATE INDEX IF NOT EXISTS idx_quick_reminders_user
    ON quick_reminders(user_id, remind_at)
    WHERE delivered_at IS NULL;
