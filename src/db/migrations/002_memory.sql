-- Luna Chat Memory System Schema
-- Enables long-term memory with vector search and fact extraction

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Message embeddings for semantic search
CREATE TABLE IF NOT EXISTS message_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    embedding vector(1536), -- OpenAI text-embedding-3-small dimension
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User facts extracted from conversations
CREATE TABLE IF NOT EXISTS user_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- personal, preference, work, hobby, relationship, etc.
    fact_key VARCHAR(100) NOT NULL, -- e.g., "name", "favorite_color", "job_title"
    fact_value TEXT NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_mentioned TIMESTAMPTZ DEFAULT NOW(),
    mention_count INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id, category, fact_key)
);

-- Conversation summaries for context
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    topics TEXT[], -- Array of main topics discussed
    sentiment VARCHAR(20), -- positive, neutral, negative
    key_points TEXT[], -- Important points from the conversation
    embedding vector(1536),
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_embeddings_user_id ON message_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_message_embeddings_session_id ON message_embeddings(session_id);
CREATE INDEX IF NOT EXISTS idx_message_embeddings_created_at ON message_embeddings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_facts_user_id ON user_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_facts_category ON user_facts(category);
CREATE INDEX IF NOT EXISTS idx_user_facts_active ON user_facts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_facts_last_mentioned ON user_facts(last_mentioned DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user_id ON conversation_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_session_id ON conversation_summaries(session_id);

-- Vector indexes for similarity search (using IVFFlat for better performance)
CREATE INDEX IF NOT EXISTS idx_message_embeddings_vector ON message_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_vector ON conversation_summaries
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Updated_at trigger for user_facts
DROP TRIGGER IF EXISTS update_user_facts_updated_at ON user_facts;
CREATE TRIGGER update_user_facts_updated_at
    BEFORE UPDATE ON user_facts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for conversation_summaries
DROP TRIGGER IF EXISTS update_conversation_summaries_updated_at ON conversation_summaries;
CREATE TRIGGER update_conversation_summaries_updated_at
    BEFORE UPDATE ON conversation_summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to search similar messages by vector
CREATE OR REPLACE FUNCTION search_similar_messages(
    query_embedding vector(1536),
    target_user_id UUID,
    match_count INTEGER DEFAULT 5,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    message_id UUID,
    session_id UUID,
    content TEXT,
    role VARCHAR(20),
    similarity FLOAT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.message_id,
        me.session_id,
        me.content,
        me.role,
        1 - (me.embedding <=> query_embedding) as similarity,
        me.created_at
    FROM message_embeddings me
    WHERE me.user_id = target_user_id
        AND 1 - (me.embedding <=> query_embedding) > similarity_threshold
    ORDER BY me.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get user facts by category
CREATE OR REPLACE FUNCTION get_user_facts_by_category(
    target_user_id UUID,
    target_category VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
    category VARCHAR(50),
    fact_key VARCHAR(100),
    fact_value TEXT,
    confidence FLOAT,
    last_mentioned TIMESTAMPTZ,
    mention_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        uf.category,
        uf.fact_key,
        uf.fact_value,
        uf.confidence,
        uf.last_mentioned,
        uf.mention_count
    FROM user_facts uf
    WHERE uf.user_id = target_user_id
        AND uf.is_active = true
        AND (target_category IS NULL OR uf.category = target_category)
    ORDER BY uf.mention_count DESC, uf.last_mentioned DESC;
END;
$$ LANGUAGE plpgsql;
