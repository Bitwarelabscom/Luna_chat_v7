-- Fast Critique Pipeline with Background Processing
-- Implements hint injection and self-correction system

-- ============================================
-- Session Critique Hints (Short-lived)
-- ============================================

-- Hints generated from critique failures, scoped to session
CREATE TABLE IF NOT EXISTS session_critique_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    hint_type TEXT NOT NULL,  -- 'avoid_verbose', 'avoid_chatbot', etc.
    hint_text TEXT NOT NULL,  -- The actual hint to inject into prompts
    weight FLOAT NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_hints_session ON session_critique_hints(session_id);
CREATE INDEX IF NOT EXISTS idx_session_hints_created ON session_critique_hints(session_id, created_at DESC);

-- ============================================
-- User Critique Hints (Persistent with Decay)
-- ============================================

-- Long-term hints that persist across sessions, with time decay
CREATE TABLE IF NOT EXISTS user_critique_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hint_type TEXT NOT NULL,
    hint_text TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    weight FLOAT NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, hint_type)
);

CREATE INDEX IF NOT EXISTS idx_user_hints_user ON user_critique_hints(user_id);
CREATE INDEX IF NOT EXISTS idx_user_hints_weight ON user_critique_hints(user_id, weight DESC);

-- ============================================
-- Pending Corrections
-- ============================================

-- Corrections to be addressed in next response
CREATE TABLE IF NOT EXISTS pending_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    turn_id UUID NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('minor', 'moderate', 'serious')),
    issues JSONB NOT NULL,
    fix_instructions TEXT,
    original_response TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_corrections_session ON pending_corrections(session_id, processed);
CREATE INDEX IF NOT EXISTS idx_pending_corrections_unprocessed ON pending_corrections(session_id) WHERE processed = FALSE;

-- ============================================
-- Critique Queue Log (Observability)
-- ============================================

-- Track background critique job processing
CREATE TABLE IF NOT EXISTS critique_queue_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id UUID NOT NULL,
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    result JSONB,
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_critique_queue_turn ON critique_queue_log(turn_id);
CREATE INDEX IF NOT EXISTS idx_critique_queue_status ON critique_queue_log(status);
CREATE INDEX IF NOT EXISTS idx_critique_queue_user ON critique_queue_log(user_id, created_at DESC);

-- ============================================
-- Hint Weight Decay Function
-- ============================================

-- Decay user hint weights over time (call daily)
CREATE OR REPLACE FUNCTION decay_user_hint_weights(decay_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
    deleted_count INTEGER;
BEGIN
    -- Decay weights based on time since last seen
    -- Weight decays by 10% per decay_days period
    UPDATE user_critique_hints
    SET weight = GREATEST(0.1, weight * POWER(0.9, EXTRACT(EPOCH FROM (NOW() - last_seen)) / (86400 * decay_days)))
    WHERE last_seen < NOW() - INTERVAL '1 day';

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    -- Delete hints with very low weight (effectively forgotten)
    DELETE FROM user_critique_hints WHERE weight < 0.15;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Hint Statistics View
-- ============================================

CREATE OR REPLACE VIEW hint_statistics AS
SELECT
    u.id as user_id,
    u.email,
    COUNT(DISTINCT sh.id) as session_hints_count,
    COUNT(DISTINCT uh.id) as user_hints_count,
    COALESCE(SUM(uh.occurrence_count), 0) as total_occurrences,
    ROUND(AVG(uh.weight)::numeric, 2) as avg_hint_weight,
    (SELECT COUNT(*) FROM pending_corrections pc
     JOIN sessions s ON s.id = pc.session_id
     WHERE s.user_id = u.id AND pc.processed = FALSE) as pending_corrections_count
FROM users u
LEFT JOIN sessions s ON s.user_id = u.id
LEFT JOIN session_critique_hints sh ON sh.session_id = s.id
LEFT JOIN user_critique_hints uh ON uh.user_id = u.id
GROUP BY u.id, u.email;

-- ============================================
-- Critique Queue Statistics View
-- ============================================

CREATE OR REPLACE VIEW critique_queue_stats AS
SELECT
    DATE_TRUNC('hour', created_at) as hour,
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    ROUND(AVG(processing_time_ms)::numeric, 0) as avg_processing_ms,
    COUNT(*) FILTER (WHERE result->>'approved' = 'false') as issues_found
FROM critique_queue_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- ============================================
-- Cleanup Function
-- ============================================

-- Cleanup old processed data
CREATE OR REPLACE FUNCTION cleanup_critique_data(days_old INTEGER DEFAULT 7)
RETURNS TABLE (
    corrections_deleted INTEGER,
    queue_logs_deleted INTEGER,
    session_hints_deleted INTEGER
) AS $$
DECLARE
    v_corrections INTEGER;
    v_queue_logs INTEGER;
    v_session_hints INTEGER;
BEGIN
    -- Delete old processed corrections
    DELETE FROM pending_corrections
    WHERE processed = TRUE
    AND created_at < NOW() - (days_old || ' days')::INTERVAL;
    GET DIAGNOSTICS v_corrections = ROW_COUNT;

    -- Delete old queue logs
    DELETE FROM critique_queue_log
    WHERE created_at < NOW() - (days_old || ' days')::INTERVAL;
    GET DIAGNOSTICS v_queue_logs = ROW_COUNT;

    -- Session hints are auto-deleted with session, but clean old orphans
    DELETE FROM session_critique_hints
    WHERE created_at < NOW() - (days_old || ' days')::INTERVAL;
    GET DIAGNOSTICS v_session_hints = ROW_COUNT;

    RETURN QUERY SELECT v_corrections, v_queue_logs, v_session_hints;
END;
$$ LANGUAGE plpgsql;
