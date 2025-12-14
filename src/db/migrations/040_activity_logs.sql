-- Activity Logs - Real-time activity tracking with archival
-- Hybrid system: SSE for live updates + DB for persistence

-- ============================================
-- Activity Logs Table (Rolling Window)
-- ============================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    turn_id UUID,  -- Optional correlation to agent_turns

    -- Activity classification
    category TEXT NOT NULL,  -- llm_call, tool_invoke, memory_op, state_event, error, background, system
    event_type TEXT NOT NULL,  -- Specific event (node_plan_complete, tool_web_search, etc.)
    level TEXT NOT NULL DEFAULT 'info',  -- info, success, warn, error

    -- Content
    title TEXT NOT NULL,
    message TEXT,
    details JSONB,  -- Structured details (tokens, duration, params, etc.)

    -- Metadata
    source TEXT,  -- Component that generated the log (layered-agent, chat-service, etc.)
    duration_ms INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_session ON activity_logs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(user_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_level ON activity_logs(user_id, level) WHERE level IN ('warn', 'error');
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);

-- ============================================
-- Activity Archive Table (Historical Storage)
-- ============================================

CREATE TABLE IF NOT EXISTS activity_archive (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    session_id UUID,
    turn_id UUID,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    level TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    details JSONB,
    source TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ DEFAULT NOW()
);

-- Archive indexes
CREATE INDEX IF NOT EXISTS idx_activity_archive_user_date ON activity_archive(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_archive_archived ON activity_archive(archived_at);

-- ============================================
-- Archive Function
-- ============================================

CREATE OR REPLACE FUNCTION archive_old_activity_logs(days_to_keep INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER;
BEGIN
    WITH moved AS (
        DELETE FROM activity_logs
        WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL
        RETURNING *
    )
    INSERT INTO activity_archive (
        id, user_id, session_id, turn_id,
        category, event_type, level,
        title, message, details,
        source, duration_ms, created_at, archived_at
    )
    SELECT
        id, user_id, session_id, turn_id,
        category, event_type, level,
        title, message, details,
        source, duration_ms, created_at, NOW()
    FROM moved;

    GET DIAGNOSTICS archived_count = ROW_COUNT;
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Cleanup Function (for old archives)
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_archives(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM activity_archive
    WHERE archived_at < NOW() - (days_to_keep || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Activity Summary View
-- ============================================

CREATE OR REPLACE VIEW activity_summary AS
SELECT
    user_id,
    DATE_TRUNC('day', created_at) as day,
    category,
    level,
    COUNT(*) as event_count
FROM activity_logs
GROUP BY user_id, DATE_TRUNC('day', created_at), category, level
ORDER BY day DESC, user_id, category;

-- ============================================
-- Recent Errors View (for quick debugging)
-- ============================================

CREATE OR REPLACE VIEW recent_errors AS
SELECT
    id, user_id, session_id, turn_id,
    category, event_type, title, message,
    details, source, created_at
FROM activity_logs
WHERE level IN ('warn', 'error')
ORDER BY created_at DESC
LIMIT 100;
