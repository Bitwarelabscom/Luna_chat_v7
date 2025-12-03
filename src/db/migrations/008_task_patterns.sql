-- Luna Chat Task Pattern Detection Schema
-- Phase 2: Track task behaviors and identify struggle patterns

-- ============================================
-- TASK ACTION HISTORY
-- ============================================
CREATE TABLE IF NOT EXISTS task_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- created, postponed, completed, cancelled, priority_changed, started
    previous_due_at TIMESTAMPTZ,
    new_due_at TIMESTAMPTZ,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    mood_at_action JSONB, -- Snapshot of user mood when action taken
    reason TEXT, -- Optional reason provided by user
    day_of_week INTEGER, -- 0-6 (Sunday-Saturday)
    hour_of_day INTEGER, -- 0-23
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_user ON task_history(user_id);
CREATE INDEX IF NOT EXISTS idx_task_history_action ON task_history(user_id, action);
CREATE INDEX IF NOT EXISTS idx_task_history_time ON task_history(user_id, created_at DESC);

-- ============================================
-- TASK-MOOD CORRELATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS task_mood_correlations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    correlation_type VARCHAR(50) NOT NULL, -- completion_by_mood, postponement_by_energy, category_by_time
    correlation_data JSONB NOT NULL,
    sample_size INTEGER DEFAULT 0,
    confidence FLOAT DEFAULT 0,
    last_calculated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, correlation_type)
);

CREATE INDEX IF NOT EXISTS idx_task_mood_corr_user ON task_mood_correlations(user_id);

-- ============================================
-- TASK CATEGORIES / STRUGGLE AREAS
-- ============================================
CREATE TABLE IF NOT EXISTS task_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    total_tasks INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    postponed_count INTEGER DEFAULT 0,
    cancelled_count INTEGER DEFAULT 0,
    avg_completion_days FLOAT, -- Average days from creation to completion
    common_struggle_factors TEXT[] DEFAULT '{}',
    best_completion_times JSONB, -- Times/days when this category gets completed most
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_task_categories_user ON task_categories(user_id);

-- ============================================
-- POSTPONEMENT PATTERNS
-- ============================================
CREATE TABLE IF NOT EXISTS postponement_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- time_of_day, day_of_week, mood_based, category_based
    pattern_data JSONB NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    confidence FLOAT DEFAULT 0.3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_postponement_user ON postponement_patterns(user_id);

-- ============================================
-- TASK RECOMMENDATIONS LOG
-- ============================================
CREATE TABLE IF NOT EXISTS task_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    recommendation_type VARCHAR(50) NOT NULL, -- timing, priority, break_suggestion, category_switch
    recommendation_data JSONB NOT NULL,
    was_followed BOOLEAN,
    outcome VARCHAR(50), -- completed, postponed, ignored
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_recs_user ON task_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_task_recs_session ON task_recommendations(session_id);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_task_mood_corr_updated_at ON task_mood_correlations;
CREATE TRIGGER update_task_mood_corr_updated_at
    BEFORE UPDATE ON task_mood_correlations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_categories_updated_at ON task_categories;
CREATE TRIGGER update_task_categories_updated_at
    BEFORE UPDATE ON task_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_postponement_patterns_updated_at ON postponement_patterns;
CREATE TRIGGER update_postponement_patterns_updated_at
    BEFORE UPDATE ON postponement_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
