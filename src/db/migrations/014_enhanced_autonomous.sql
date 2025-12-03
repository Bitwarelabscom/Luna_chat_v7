-- Enhanced Autonomous Mode
-- Adds user questions, session workspace, research collections, web page cache

-- ============================================
-- USER AVAILABILITY TOGGLE
-- ============================================

ALTER TABLE autonomous_config
ADD COLUMN IF NOT EXISTS user_available BOOLEAN DEFAULT false;

-- ============================================
-- QUESTIONS QUEUE
-- ============================================

CREATE TABLE IF NOT EXISTS autonomous_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES autonomous_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    context TEXT,
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'dismissed', 'expired')),
    asked_at TIMESTAMPTZ DEFAULT NOW(),
    answered_at TIMESTAMPTZ,
    user_response TEXT,
    expires_at TIMESTAMPTZ,
    related_goal_id UUID REFERENCES autonomous_goals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_user_pending
ON autonomous_questions(user_id, status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_questions_session
ON autonomous_questions(session_id);

CREATE INDEX IF NOT EXISTS idx_questions_expires
ON autonomous_questions(expires_at) WHERE status = 'pending' AND expires_at IS NOT NULL;

-- ============================================
-- SESSION WORKSPACE NOTES
-- ============================================

CREATE TABLE IF NOT EXISTS autonomous_session_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES autonomous_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_type VARCHAR(50) NOT NULL CHECK (note_type IN ('planning', 'observation', 'finding', 'decision', 'question', 'summary')),
    title VARCHAR(255),
    content TEXT NOT NULL,
    phase VARCHAR(20),
    related_goal_id UUID REFERENCES autonomous_goals(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_notes_session
ON autonomous_session_notes(session_id);

CREATE INDEX IF NOT EXISTS idx_session_notes_type
ON autonomous_session_notes(session_id, note_type);

-- ============================================
-- RESEARCH COLLECTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS research_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    goal_id UUID REFERENCES autonomous_goals(id) ON DELETE SET NULL,
    session_id UUID REFERENCES autonomous_sessions(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_collections_user
ON research_collections(user_id);

CREATE INDEX IF NOT EXISTS idx_research_collections_goal
ON research_collections(goal_id) WHERE goal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('web_page', 'search_result', 'rss_article', 'document', 'user_input')),
    source_url TEXT,
    title VARCHAR(500),
    content TEXT,
    summary TEXT,
    key_findings TEXT[],
    relevance_score FLOAT DEFAULT 0.5 CHECK (relevance_score >= 0 AND relevance_score <= 1),
    tags TEXT[],
    metadata JSONB,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_items_collection
ON research_items(collection_id);

CREATE INDEX IF NOT EXISTS idx_research_items_user
ON research_items(user_id);

CREATE INDEX IF NOT EXISTS idx_research_items_embedding
ON research_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- WEB PAGE CACHE
-- ============================================

CREATE TABLE IF NOT EXISTS web_page_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT UNIQUE NOT NULL,
    url_hash VARCHAR(64) NOT NULL,
    title TEXT,
    content TEXT,
    word_count INTEGER,
    author TEXT,
    published_date TIMESTAMPTZ,
    extracted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_web_cache_hash
ON web_page_cache(url_hash);

CREATE INDEX IF NOT EXISTS idx_web_cache_expires
ON web_page_cache(expires_at);

-- ============================================
-- AGENT EXECUTION LOG
-- ============================================

CREATE TABLE IF NOT EXISTS autonomous_agent_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES autonomous_sessions(id) ON DELETE CASCADE,
    deliberation_id UUID REFERENCES council_deliberations(id) ON DELETE SET NULL,
    agent_name VARCHAR(50) NOT NULL,
    task TEXT NOT NULL,
    context TEXT,
    result TEXT,
    success BOOLEAN DEFAULT true,
    execution_time_ms INTEGER,
    tokens_used INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_session
ON autonomous_agent_executions(session_id);

CREATE INDEX IF NOT EXISTS idx_agent_executions_agent
ON autonomous_agent_executions(agent_name);

-- ============================================
-- ADD PAUSED STATUS TO SESSIONS
-- ============================================

-- Allow sessions to be paused while waiting for user response
ALTER TABLE autonomous_sessions
DROP CONSTRAINT IF EXISTS autonomous_sessions_status_check;

ALTER TABLE autonomous_sessions
ADD CONSTRAINT autonomous_sessions_status_check
CHECK (status IN ('active', 'completed', 'stopped', 'error', 'paused'));

-- Add column for tracking pause reason
ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS pause_reason TEXT;

ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
