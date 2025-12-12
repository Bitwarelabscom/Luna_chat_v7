-- Migration: Add calendar event reminders
-- Adds reminder_minutes column to calendar_events_cache and tracking table for sent reminders

-- Add reminder_minutes column to calendar_events_cache
ALTER TABLE calendar_events_cache ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER DEFAULT NULL;

-- Index for efficient reminder lookup (events with reminders, ordered by start time)
CREATE INDEX IF NOT EXISTS idx_calendar_events_reminder
    ON calendar_events_cache(start_at, reminder_minutes)
    WHERE reminder_minutes IS NOT NULL;

-- Track sent reminders to prevent duplicates
CREATE TABLE IF NOT EXISTS calendar_reminder_sent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reminder_time TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, reminder_time)
);

CREATE INDEX IF NOT EXISTS idx_calendar_reminder_sent_user ON calendar_reminder_sent(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_reminder_sent_time ON calendar_reminder_sent(sent_at);
