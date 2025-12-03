-- Luna Chat Real-time Mood Awareness Schema
-- Phase 3: Session-level mood tracking and proactive adjustments

-- ============================================
-- SESSION MOOD STATE
-- ============================================
CREATE TABLE IF NOT EXISTS session_mood_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    initial_mood JSONB, -- First detected mood of session
    current_mood JSONB, -- Latest detected mood
    mood_trajectory VARCHAR(20), -- improving, stable, declining
    energy_trajectory VARCHAR(20), -- increasing, stable, decreasing
    message_count INTEGER DEFAULT 0,
    adjustments_made TEXT[] DEFAULT '{}', -- Record of adjustments made
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_mood_session ON session_mood_state(session_id);
CREATE INDEX IF NOT EXISTS idx_session_mood_user ON session_mood_state(user_id);

-- ============================================
-- ENERGY PATTERNS BY TIME
-- ============================================
CREATE TABLE IF NOT EXISTS energy_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- hourly, daily, weekly
    pattern_data JSONB NOT NULL,
    sample_count INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_energy_patterns_user ON energy_patterns(user_id);

-- ============================================
-- PROACTIVE INTERVENTIONS LOG
-- ============================================
CREATE TABLE IF NOT EXISTS proactive_interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    intervention_type VARCHAR(50) NOT NULL, -- mood_check, break_suggestion, energy_adjustment, encouragement
    trigger_condition JSONB NOT NULL, -- What triggered this intervention
    intervention_content TEXT, -- What was said/suggested
    user_response VARCHAR(50), -- accepted, declined, ignored
    was_helpful BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventions_user ON proactive_interventions(user_id);
CREATE INDEX IF NOT EXISTS idx_interventions_session ON proactive_interventions(session_id);
CREATE INDEX IF NOT EXISTS idx_interventions_type ON proactive_interventions(user_id, intervention_type);

-- ============================================
-- MOOD SHIFT DETECTION
-- ============================================
CREATE TABLE IF NOT EXISTS mood_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    shift_type VARCHAR(50) NOT NULL, -- positive_shift, negative_shift, energy_drop, energy_spike
    from_state JSONB NOT NULL,
    to_state JSONB NOT NULL,
    trigger_topic TEXT, -- Topic that may have caused the shift
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mood_shifts_user ON mood_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_shifts_session ON mood_shifts(session_id);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_session_mood_updated_at ON session_mood_state;
CREATE TRIGGER update_session_mood_updated_at
    BEFORE UPDATE ON session_mood_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_energy_patterns_updated_at ON energy_patterns;
CREATE TRIGGER update_energy_patterns_updated_at
    BEFORE UPDATE ON energy_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
