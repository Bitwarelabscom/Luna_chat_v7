-- ============================================
-- PROACTIVE TRIGGERS MIGRATION
-- Luna's ability to proactively message users
-- ============================================

-- ============================================
-- PENDING TRIGGERS QUEUE
-- Central queue for all triggers awaiting delivery
-- ============================================
CREATE TABLE IF NOT EXISTS pending_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES checkin_schedules(id) ON DELETE SET NULL,
    trigger_source VARCHAR(50) NOT NULL, -- 'schedule', 'webhook', 'event', 'pattern', 'insight'
    trigger_type VARCHAR(50) NOT NULL, -- specific type: 'time', 'mood_low', 'task_due', etc.
    payload JSONB DEFAULT '{}',
    message TEXT NOT NULL, -- The rendered message to send
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, delivered, failed
    delivery_method VARCHAR(20) DEFAULT 'chat', -- 'chat', 'push', 'sse'
    target_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    priority INTEGER DEFAULT 5, -- 1-10, higher = more urgent
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_triggers_user ON pending_triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_triggers_status ON pending_triggers(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pending_triggers_pending ON pending_triggers(status, priority DESC, created_at)
    WHERE status = 'pending';

-- ============================================
-- PUSH SUBSCRIPTIONS (Web Push API)
-- ============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    device_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(user_id, is_active)
    WHERE is_active = true;

-- ============================================
-- TRIGGER HISTORY (Audit log)
-- ============================================
CREATE TABLE IF NOT EXISTS trigger_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger_id UUID REFERENCES pending_triggers(id) ON DELETE SET NULL,
    schedule_id UUID REFERENCES checkin_schedules(id) ON DELETE SET NULL,
    trigger_source VARCHAR(50) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    message_sent TEXT NOT NULL,
    delivery_method VARCHAR(20) NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    user_responded BOOLEAN DEFAULT false,
    response_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trigger_history_user ON trigger_history(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_history_created ON trigger_history(created_at DESC);

-- ============================================
-- WEBHOOKS (External integrations)
-- ============================================
CREATE TABLE IF NOT EXISTS trigger_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    secret_hash TEXT, -- For signature validation
    delivery_method VARCHAR(20) DEFAULT 'chat',
    prompt_template TEXT, -- Template with {payload.field} placeholders
    is_enabled BOOLEAN DEFAULT true,
    call_count INTEGER DEFAULT 0,
    last_called_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trigger_webhooks_user ON trigger_webhooks(user_id);

-- ============================================
-- USER NOTIFICATION PREFERENCES
-- ============================================
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Delivery preferences
    enable_chat_notifications BOOLEAN DEFAULT true,
    enable_push_notifications BOOLEAN DEFAULT false,
    enable_email_digest BOOLEAN DEFAULT false,

    -- Quiet hours
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME DEFAULT '22:00',
    quiet_hours_end TIME DEFAULT '08:00',
    timezone VARCHAR(50) DEFAULT 'UTC',

    -- Trigger type preferences
    enable_reminders BOOLEAN DEFAULT true,
    enable_checkins BOOLEAN DEFAULT true,
    enable_insights BOOLEAN DEFAULT true,
    enable_achievements BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- ============================================
-- DEDICATED LUNA UPDATES SESSION
-- Each user gets a special session for proactive messages
-- ============================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_luna_updates BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_luna_updates ON sessions(user_id, is_luna_updates)
    WHERE is_luna_updates = true;

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get or create Luna Updates session for a user
CREATE OR REPLACE FUNCTION get_or_create_luna_updates_session(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- Try to find existing Luna Updates session
    SELECT id INTO v_session_id
    FROM sessions
    WHERE user_id = p_user_id AND is_luna_updates = true
    LIMIT 1;

    -- Create if not exists
    IF v_session_id IS NULL THEN
        INSERT INTO sessions (user_id, title, mode, is_luna_updates)
        VALUES (p_user_id, 'Luna Updates', 'assistant', true)
        RETURNING id INTO v_session_id;
    END IF;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- Clean up old pending triggers (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_pending_triggers()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM pending_triggers
    WHERE created_at < NOW() - INTERVAL '24 hours'
      AND status IN ('delivered', 'failed');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
