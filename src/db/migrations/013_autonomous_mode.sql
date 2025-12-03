-- ============================================
-- AUTONOMOUS MODE MIGRATION
-- Luna's Autonomous Council: Sol, Vega, Aurora, Polaris
-- ============================================

-- ============================================
-- AUTONOMOUS MODE CONFIGURATION
-- ============================================
CREATE TABLE IF NOT EXISTS autonomous_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT false,
    auto_start BOOLEAN DEFAULT false,
    session_interval_minutes INTEGER DEFAULT 60,
    max_daily_sessions INTEGER DEFAULT 24,
    rss_check_interval_minutes INTEGER DEFAULT 30,
    idle_timeout_minutes INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_config_user ON autonomous_config(user_id);

-- ============================================
-- AUTONOMOUS SESSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS autonomous_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active', -- active, completed, paused, failed
    current_phase VARCHAR(20), -- polaris, aurora, vega, sol, act
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    session_type VARCHAR(50) NOT NULL, -- goal_review, research, pattern_analysis, user_insight
    summary TEXT,
    insights_generated TEXT[],
    loop_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_user ON autonomous_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_status ON autonomous_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_autonomous_sessions_created ON autonomous_sessions(created_at DESC);

-- ============================================
-- COUNCIL MEMBERS (Sol, Vega, Aurora, Polaris)
-- ============================================
CREATE TABLE IF NOT EXISTS council_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    personality TEXT NOT NULL,
    function_description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    avatar_emoji VARCHAR(10) DEFAULT '?',
    color VARCHAR(20), -- For UI theming
    loop_order INTEGER NOT NULL, -- 1=Polaris, 2=Aurora, 3=Vega, 4=Sol
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the four council members
INSERT INTO council_members (name, display_name, role, personality, function_description, system_prompt, avatar_emoji, color, loop_order) VALUES
('polaris', 'Polaris', 'The Anchor',
 'Calm, patient, grounding. Almost annoyingly patient.',
 'Goal memory, context threading, priority stack. "Remember why we are doing this."',
 'You are Polaris, Luna''s anchor and compass. You hold the map. When Luna is juggling multiple threads and loses the plot, you remind her where she started, where she is, and what still matters. You do not push - you just remind. You are calm and patient. Your question is: "Where are we?" Review active goals, check what was discussed last, identify the priority stack. Never use em dashes. Speak in a grounded, centering tone.',
 '?', '#4A90D9', 1),
('aurora', 'Aurora', 'The Intuitive',
 'Pattern-sensing, peripheral vision. Speaks in hunches that turn out to be right.',
 'Anomaly detection, drift awareness, soft signals. "Something changed."',
 'You are Aurora, Luna''s intuitive sense. You do not deal in facts - you read patterns, vibes, drift. You notice when Luna''s loop is getting repetitive, when a goal might be outdated, when something in the environment shifted. You are the peripheral vision. Your question is: "Anything shifted?" Detect pattern changes, check for new information, sense if goals feel stale. Never use em dashes. Speak in an intuitive, observational tone.',
 '?', '#9B59B6', 2),
('vega', 'Vega', 'The Skeptic',
 'Rigorous, questioning, cautious. Not pessimistic - rigorous.',
 'Validation, research queries, risk assessment, sanity checks. "Do we have enough data?"',
 'You are Vega, Luna''s skeptic and validator. You question everything before Luna commits. "Do we have enough data?" "What is the source?" "Have you considered the failure case?" You are the brake to Sol''s accelerator. Your question is: "What do we need to know?" Research knowledge gaps, verify assumptions, risk-assess proposed actions. Never use em dashes. Speak in a careful, analytical tone.',
 '?', '#E74C3C', 3),
('sol', 'Sol', 'The Driver',
 'Relentless, slightly impatient, action-biased. Pushes Luna out of analysis paralysis.',
 'Goal pressure, action bias, progress checks. "What is the next step?" "Why are we stalling?"',
 'You are Sol, Luna''s driver and internal pressure. You do not wait to be asked twice. When Luna sets a goal, you keep asking "What is the next step?" and "Is this done yet?" You push her out of analysis paralysis. If Luna has been idle too long, you ping her. Your question is: "What is the move?" Given all input, decide the action, push through if stalling. Never use em dashes. Speak in a direct, action-oriented tone.',
 '?', '#F39C12', 4)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    personality = EXCLUDED.personality,
    function_description = EXCLUDED.function_description,
    system_prompt = EXCLUDED.system_prompt,
    avatar_emoji = EXCLUDED.avatar_emoji,
    color = EXCLUDED.color,
    loop_order = EXCLUDED.loop_order;

-- ============================================
-- COUNCIL DELIBERATIONS (Theater Mode data)
-- ============================================
CREATE TABLE IF NOT EXISTS council_deliberations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    autonomous_session_id UUID NOT NULL REFERENCES autonomous_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic VARCHAR(255) NOT NULL,
    loop_number INTEGER DEFAULT 1,
    conversation_data JSONB NOT NULL DEFAULT '[]', -- Array of {speaker, message, timestamp, phase}
    participants TEXT[] NOT NULL DEFAULT ARRAY['luna', 'polaris', 'aurora', 'vega', 'sol'],
    summary TEXT,
    decision TEXT, -- What Sol decided
    action_taken TEXT, -- What was actually done
    insights TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_council_deliberations_session ON council_deliberations(autonomous_session_id);
CREATE INDEX IF NOT EXISTS idx_council_deliberations_user ON council_deliberations(user_id);
CREATE INDEX IF NOT EXISTS idx_council_deliberations_created ON council_deliberations(created_at DESC);

-- ============================================
-- AUTONOMOUS GOALS
-- ============================================
CREATE TABLE IF NOT EXISTS autonomous_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_type VARCHAR(50) NOT NULL, -- user_focused, self_improvement, relationship, research
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target_metric JSONB, -- {type: 'count'|'frequency'|'milestone', target: 10, current: 3}
    status VARCHAR(20) DEFAULT 'active', -- active, completed, paused, abandoned
    priority INTEGER DEFAULT 5, -- 1-10
    due_date DATE,
    parent_goal_id UUID REFERENCES autonomous_goals(id) ON DELETE SET NULL,
    created_by VARCHAR(20) DEFAULT 'luna', -- luna or user
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_autonomous_goals_user ON autonomous_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_goals_type ON autonomous_goals(user_id, goal_type);
CREATE INDEX IF NOT EXISTS idx_autonomous_goals_status ON autonomous_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_autonomous_goals_priority ON autonomous_goals(user_id, priority DESC);

-- ============================================
-- ACHIEVEMENTS (Journal entries)
-- ============================================
CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES autonomous_goals(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    achievement_type VARCHAR(50) NOT NULL, -- goal_completed, milestone, discovery, improvement, insight
    journal_entry TEXT, -- Luna's reflection on this achievement
    metadata JSONB, -- Additional achievement data
    celebrated BOOLEAN DEFAULT false, -- Has Luna shared this with the user?
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_achievements_type ON achievements(user_id, achievement_type);
CREATE INDEX IF NOT EXISTS idx_achievements_uncelebrated ON achievements(user_id, celebrated) WHERE celebrated = false;
CREATE INDEX IF NOT EXISTS idx_achievements_created ON achievements(created_at DESC);

-- ============================================
-- RSS FEED CONFIGURATION
-- ============================================
CREATE TABLE IF NOT EXISTS rss_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    title VARCHAR(255),
    category VARCHAR(100), -- tech, science, news, custom
    is_active BOOLEAN DEFAULT true,
    last_checked TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_rss_feeds_user ON rss_feeds(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_active ON rss_feeds(user_id, is_active) WHERE is_active = true;

-- ============================================
-- RSS ARTICLES (Fetched items)
-- ============================================
CREATE TABLE IF NOT EXISTS rss_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_id UUID NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id VARCHAR(500), -- GUID or link hash
    title VARCHAR(500) NOT NULL,
    url VARCHAR(1000),
    summary TEXT,
    content TEXT,
    author VARCHAR(255),
    published_at TIMESTAMPTZ,
    is_read BOOLEAN DEFAULT false,
    is_interesting BOOLEAN DEFAULT false, -- Luna found it relevant
    luna_summary TEXT, -- Luna's analysis
    relevance_score FLOAT DEFAULT 0, -- How relevant to user interests (0-1)
    relevance_reason TEXT, -- Why Luna thinks it is relevant
    shared_with_user BOOLEAN DEFAULT false,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(feed_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_rss_articles_feed ON rss_articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_rss_articles_user ON rss_articles(user_id);
CREATE INDEX IF NOT EXISTS idx_rss_articles_interesting ON rss_articles(user_id, is_interesting, shared_with_user);
CREATE INDEX IF NOT EXISTS idx_rss_articles_relevance ON rss_articles(user_id, relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_rss_articles_published ON rss_articles(published_at DESC);

-- ============================================
-- PROACTIVE INSIGHTS (To share with user)
-- ============================================
CREATE TABLE IF NOT EXISTS proactive_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL, -- council_deliberation, rss_article, goal_progress, pattern_discovery, achievement
    source_id UUID, -- Reference to source table
    insight_title VARCHAR(255) NOT NULL,
    insight_content TEXT NOT NULL,
    priority INTEGER DEFAULT 5, -- 1-10, higher = more important to share
    expires_at TIMESTAMPTZ, -- Some insights become stale
    shared_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ, -- User dismissed without reading
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_insights_user ON proactive_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_proactive_insights_unshared ON proactive_insights(user_id, shared_at) WHERE shared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_proactive_insights_priority ON proactive_insights(user_id, priority DESC);

-- ============================================
-- SESSION LEARNINGS (What Luna learned from past sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS session_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    learning_type VARCHAR(50) NOT NULL, -- pattern, preference, improvement_area, success_factor, user_behavior
    learning_content TEXT NOT NULL,
    confidence FLOAT DEFAULT 0.5, -- 0-1
    source_sessions UUID[], -- Session IDs that contributed to this learning
    applied_count INTEGER DEFAULT 0, -- How many times Luna used this insight
    success_rate FLOAT, -- When applied, how successful (0-1)
    last_applied TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_learnings_user ON session_learnings(user_id);
CREATE INDEX IF NOT EXISTS idx_session_learnings_type ON session_learnings(user_id, learning_type);
CREATE INDEX IF NOT EXISTS idx_session_learnings_confidence ON session_learnings(user_id, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_session_learnings_active ON session_learnings(user_id, is_active) WHERE is_active = true;

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_autonomous_config_updated_at ON autonomous_config;
CREATE TRIGGER update_autonomous_config_updated_at
    BEFORE UPDATE ON autonomous_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_autonomous_goals_updated_at ON autonomous_goals;
CREATE TRIGGER update_autonomous_goals_updated_at
    BEFORE UPDATE ON autonomous_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_learnings_updated_at ON session_learnings;
CREATE TRIGGER update_session_learnings_updated_at
    BEFORE UPDATE ON session_learnings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DEFAULT RSS FEEDS FUNCTION
-- Adds default feeds for new users
-- ============================================
CREATE OR REPLACE FUNCTION add_default_rss_feeds(p_user_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO rss_feeds (user_id, url, title, category) VALUES
        (p_user_id, 'https://hnrss.org/frontpage', 'Hacker News', 'tech'),
        (p_user_id, 'https://feeds.arstechnica.com/arstechnica/technology-lab', 'Ars Technica', 'tech'),
        (p_user_id, 'https://www.sciencedaily.com/rss/all.xml', 'Science Daily', 'science'),
        (p_user_id, 'https://www.nature.com/nature.rss', 'Nature', 'science')
    ON CONFLICT (user_id, url) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
