-- Intent System Schema

-- Create intents table
CREATE TABLE IF NOT EXISTS intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    confidence_score FLOAT DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'closed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_intents_user_id ON intents(user_id);
CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
CREATE INDEX IF NOT EXISTS idx_intents_last_active ON intents(last_active_at DESC);

-- Update sessions table
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS primary_intent_id UUID REFERENCES intents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS secondary_intent_ids UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX IF NOT EXISTS idx_sessions_primary_intent ON sessions(primary_intent_id);

-- Update user_facts table
ALTER TABLE user_facts
ADD COLUMN IF NOT EXISTS intent_id UUID REFERENCES intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_facts_intent ON user_facts(intent_id);

-- Update message_embeddings table
ALTER TABLE message_embeddings
ADD COLUMN IF NOT EXISTS intent_id UUID REFERENCES intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_message_embeddings_intent ON message_embeddings(intent_id);

-- Update conversation_summaries table
ALTER TABLE conversation_summaries
ADD COLUMN IF NOT EXISTS intent_id UUID REFERENCES intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_intent ON conversation_summaries(intent_id);
