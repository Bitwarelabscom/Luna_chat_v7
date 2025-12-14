-- Layered Agent Architecture Schema
-- Implements event-sourced state, identity pinning, and turn observability

-- ============================================
-- Identity Management (Policy Objects)
-- ============================================

-- Identity versions (immutable - versions are append-only)
CREATE TABLE IF NOT EXISTS identities (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    policy JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, version)
);

-- Pin identity version per session (identity never changes during session)
CREATE TABLE IF NOT EXISTS identity_pins (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    identity_id TEXT NOT NULL,
    identity_version INTEGER NOT NULL,
    pinned_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (identity_id, identity_version) REFERENCES identities(id, version)
);

CREATE INDEX IF NOT EXISTS idx_identity_pins_identity ON identity_pins(identity_id, identity_version);

-- ============================================
-- Event-Sourced State (Append-Only Log)
-- ============================================

-- State events log - append-only, no updates allowed
CREATE TABLE IF NOT EXISTS state_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_id UUID, -- message_id that triggered this event (nullable for system events)
    event_type TEXT NOT NULL, -- topic_shift, mood_change, task_update, user_goal, interaction
    event_value TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    meta JSONB -- additional structured data
);

CREATE INDEX IF NOT EXISTS idx_state_events_session_ts ON state_events(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_state_events_type ON state_events(event_type);

-- ============================================
-- Turn Observability (Per-Turn Logging)
-- ============================================

-- Per-turn observability for debugging and drift detection
CREATE TABLE IF NOT EXISTS agent_turns (
    turn_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    identity_id TEXT NOT NULL,
    identity_version INTEGER NOT NULL,
    user_input TEXT NOT NULL,
    plan TEXT,
    draft TEXT,
    final_output TEXT,
    critique_passed BOOLEAN,
    critique_issues JSONB, -- array of issue strings
    attempts INTEGER DEFAULT 1,
    execution_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_session ON agent_turns(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_turns_critique ON agent_turns(critique_passed);

-- ============================================
-- Memory Enhancements
-- ============================================

-- Add metadata columns to existing message_embeddings for filtered retrieval
ALTER TABLE message_embeddings ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE message_embeddings ADD COLUMN IF NOT EXISTS meta JSONB;

-- Index for tag-based filtering
CREATE INDEX IF NOT EXISTS idx_message_embeddings_tags ON message_embeddings USING GIN (tags);

-- ============================================
-- Drift Metrics View
-- ============================================

-- View for calculating repair rate and other drift metrics
CREATE OR REPLACE VIEW agent_drift_metrics AS
SELECT
    DATE_TRUNC('day', created_at) as day,
    identity_id,
    identity_version,
    COUNT(*) as total_turns,
    COUNT(*) FILTER (WHERE attempts > 1) as repair_turns,
    ROUND(100.0 * COUNT(*) FILTER (WHERE attempts > 1) / NULLIF(COUNT(*), 0), 2) as repair_rate_pct,
    ROUND(AVG(attempts)::numeric, 2) as avg_attempts,
    COUNT(*) FILTER (WHERE NOT critique_passed) as failed_critiques,
    ROUND(AVG(execution_time_ms)::numeric, 0) as avg_execution_time_ms
FROM agent_turns
GROUP BY DATE_TRUNC('day', created_at), identity_id, identity_version
ORDER BY day DESC, identity_id, identity_version;

-- ============================================
-- Helper Functions
-- ============================================

-- Function to get latest identity version
CREATE OR REPLACE FUNCTION get_latest_identity_version(p_identity_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN COALESCE(
        (SELECT MAX(version) FROM identities WHERE id = p_identity_id),
        0
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get session's pinned identity
CREATE OR REPLACE FUNCTION get_session_identity(p_session_id UUID)
RETURNS TABLE (
    identity_id TEXT,
    identity_version INTEGER,
    policy JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.version, i.policy
    FROM identity_pins ip
    JOIN identities i ON i.id = ip.identity_id AND i.version = ip.identity_version
    WHERE ip.session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;

-- Function to compute AgentView snapshot from events
CREATE OR REPLACE FUNCTION compute_agent_view(p_session_id UUID)
RETURNS TABLE (
    current_topic TEXT,
    current_mood TEXT,
    active_task TEXT,
    active_plan TEXT,
    interaction_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_events AS (
        SELECT DISTINCT ON (event_type) event_type, event_value, ts
        FROM state_events
        WHERE session_id = p_session_id
        ORDER BY event_type, ts DESC
    )
    SELECT
        (SELECT event_value FROM latest_events WHERE event_type = 'topic_shift'),
        (SELECT event_value FROM latest_events WHERE event_type = 'mood_change'),
        (SELECT event_value FROM latest_events WHERE event_type = 'task_update'),
        (SELECT event_value FROM latest_events WHERE event_type = 'user_goal'),
        (SELECT COUNT(*) FROM state_events WHERE session_id = p_session_id AND event_type = 'interaction');
END;
$$ LANGUAGE plpgsql;
