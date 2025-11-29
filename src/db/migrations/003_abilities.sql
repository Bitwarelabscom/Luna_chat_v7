-- Luna Chat Extended Abilities Schema
-- Adds: Knowledge Base, Tasks, Documents, Tools, Agents, Check-ins, Mood Tracking

-- ============================================
-- PERSONAL KNOWLEDGE BASE
-- ============================================
CREATE TABLE IF NOT EXISTS knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100), -- notes, secrets, references, procedures
    tags TEXT[] DEFAULT '{}',
    is_pinned BOOLEAN DEFAULT false,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_items(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_items(user_id, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_vector ON knowledge_items
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- TASK/REMINDER SYSTEM
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    due_at TIMESTAMPTZ,
    remind_at TIMESTAMPTZ,
    recurrence VARCHAR(50), -- daily, weekly, monthly, yearly, custom
    recurrence_rule TEXT, -- iCal RRULE format for complex recurrence
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    completed_at TIMESTAMPTZ,
    source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    notification_sent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(remind_at) WHERE remind_at IS NOT NULL AND notification_sent = false;

-- ============================================
-- DOCUMENT STORAGE
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'processing', -- processing, ready, error
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_vector ON document_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- CUSTOM TOOLS/PLUGINS
-- ============================================
CREATE TABLE IF NOT EXISTS custom_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    tool_type VARCHAR(50) NOT NULL, -- api, webhook, function
    config JSONB NOT NULL, -- API endpoint, headers, params schema
    is_enabled BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tools_user ON custom_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON custom_tools(user_id, is_enabled);

-- ============================================
-- CODE EXECUTION HISTORY
-- ============================================
CREATE TABLE IF NOT EXISTS code_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    language VARCHAR(20) NOT NULL, -- python, javascript
    code TEXT NOT NULL,
    output TEXT,
    error TEXT,
    execution_time_ms INTEGER,
    status VARCHAR(20) NOT NULL, -- success, error, timeout
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executions_user ON code_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_session ON code_executions(session_id);

-- ============================================
-- MULTI-AGENT CONFIGURATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS agent_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    model VARCHAR(50) DEFAULT 'gpt-4o',
    temperature FLOAT DEFAULT 0.7,
    tools TEXT[] DEFAULT '{}', -- enabled tools for this agent
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agent_configs(user_id);

-- ============================================
-- CALENDAR INTEGRATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS calendar_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- google, outlook, caldav
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    calendar_id VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS calendar_events_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    location TEXT,
    is_all_day BOOLEAN DEFAULT false,
    attendees JSONB,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events_cache(connection_id, start_at);

-- ============================================
-- EMAIL INTEGRATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS email_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- gmail, outlook, imap
    email_address VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS email_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES email_connections(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    thread_id VARCHAR(255),
    subject VARCHAR(1000),
    from_address VARCHAR(255),
    to_addresses TEXT[],
    snippet TEXT,
    body_preview TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    is_read BOOLEAN DEFAULT false,
    is_important BOOLEAN DEFAULT false,
    labels TEXT[] DEFAULT '{}',
    embedding vector(1536),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_email_user ON email_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_email_cache_time ON email_cache(connection_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_cache_vector ON email_cache
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- PROACTIVE CHECK-INS
-- ============================================
CREATE TABLE IF NOT EXISTS checkin_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL, -- time, pattern, event
    trigger_config JSONB NOT NULL, -- cron expression, pattern rules
    prompt_template TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    next_trigger_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkin_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES checkin_schedules(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger_reason TEXT,
    message_sent TEXT,
    user_responded BOOLEAN DEFAULT false,
    response_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkin_user ON checkin_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_next ON checkin_schedules(next_trigger_at) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_checkin_history_user ON checkin_history(user_id);

-- ============================================
-- EMOTIONAL INTELLIGENCE / MOOD TRACKING
-- ============================================
CREATE TABLE IF NOT EXISTS mood_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    sentiment VARCHAR(20) NOT NULL, -- very_negative, negative, neutral, positive, very_positive
    sentiment_score FLOAT, -- -1.0 to 1.0
    emotions TEXT[] DEFAULT '{}', -- joy, sadness, anger, fear, surprise, etc.
    energy_level VARCHAR(20), -- low, medium, high
    topics TEXT[] DEFAULT '{}',
    notes TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mood_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50) NOT NULL, -- daily, weekly, trigger
    pattern_data JSONB NOT NULL,
    confidence FLOAT DEFAULT 0.5,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_mood_user ON mood_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_time ON mood_entries(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mood_patterns_user ON mood_patterns(user_id);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_knowledge_items_updated_at ON knowledge_items;
CREATE TRIGGER update_knowledge_items_updated_at
    BEFORE UPDATE ON knowledge_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_custom_tools_updated_at ON custom_tools;
CREATE TRIGGER update_custom_tools_updated_at
    BEFORE UPDATE ON custom_tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_configs_updated_at ON agent_configs;
CREATE TRIGGER update_agent_configs_updated_at
    BEFORE UPDATE ON agent_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
