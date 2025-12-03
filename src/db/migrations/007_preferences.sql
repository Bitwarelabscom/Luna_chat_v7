-- Luna Chat Preference Learning Schema
-- Phase 1: Long-term preference tracking and personalization

-- ============================================
-- USER COMMUNICATION PREFERENCES
-- ============================================
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_type VARCHAR(50) NOT NULL, -- response_length, formality, detail_level, explanation_style
    preference_value JSONB NOT NULL,
    learned_from_count INTEGER DEFAULT 1,
    confidence FLOAT DEFAULT 0.3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, preference_type)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_type ON user_preferences(user_id, preference_type);

-- ============================================
-- TOPIC INTEREST TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS user_topic_interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic VARCHAR(255) NOT NULL,
    interest_score FLOAT DEFAULT 0.5, -- 0.0 to 1.0
    engagement_count INTEGER DEFAULT 1,
    last_engaged TIMESTAMPTZ DEFAULT NOW(),
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_topic_interests_user ON user_topic_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_topic_interests_score ON user_topic_interests(user_id, interest_score DESC);
CREATE INDEX IF NOT EXISTS idx_topic_interests_vector ON user_topic_interests
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- RESPONSE STYLE PREFERENCES
-- ============================================
CREATE TABLE IF NOT EXISTS response_style_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    style_dimension VARCHAR(50) NOT NULL, -- verbosity, technicality, warmth, directness, encouragement
    preferred_level FLOAT DEFAULT 0.5, -- 0.0 to 1.0 scale
    positive_examples JSONB DEFAULT '[]', -- Examples user responded well to
    negative_examples JSONB DEFAULT '[]', -- Examples user corrected or didn't like
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, style_dimension)
);

CREATE INDEX IF NOT EXISTS idx_style_prefs_user ON response_style_preferences(user_id);

-- ============================================
-- FEEDBACK TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS user_feedback_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    message_id UUID,
    signal_type VARCHAR(50) NOT NULL, -- correction, praise, elaboration_request, shorter_request
    signal_content TEXT,
    inferred_preference JSONB, -- What we learned from this
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON user_feedback_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_session ON user_feedback_signals(session_id);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_topic_interests_updated_at ON user_topic_interests;
CREATE TRIGGER update_topic_interests_updated_at
    BEFORE UPDATE ON user_topic_interests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_style_prefs_updated_at ON response_style_preferences;
CREATE TRIGGER update_style_prefs_updated_at
    BEFORE UPDATE ON response_style_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
