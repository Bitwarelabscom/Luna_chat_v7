-- Friend Personalities table - Luna's AI friends with editable prompts
CREATE TABLE IF NOT EXISTS friend_personalities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    personality TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    avatar_emoji VARCHAR(10) DEFAULT '🤖',
    color VARCHAR(20) DEFAULT '#808080',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint for default friends per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_personalities_user_name ON friend_personalities(user_id, name);

-- Friend Conversations table for Luna's discussions with her AI friends
CREATE TABLE IF NOT EXISTS friend_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES autonomous_sessions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    trigger_type VARCHAR(20) NOT NULL DEFAULT 'random',
    friend_id UUID REFERENCES friend_personalities(id) ON DELETE SET NULL,
    messages JSONB DEFAULT '[]',
    summary TEXT,
    facts_extracted TEXT[] DEFAULT '{}',
    round_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_friend_conversations_user_id ON friend_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_conversations_session_id ON friend_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_friend_conversations_friend_id ON friend_conversations(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_conversations_created_at ON friend_conversations(created_at DESC);

-- Add 'friend' to user_model_config if not exists
INSERT INTO user_model_config (user_id, task_type, provider, model)
SELECT u.id, 'friend', 'ollama', 'llama3.2:3b'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_model_config mc WHERE mc.user_id = u.id AND mc.task_type = 'friend'
)
ON CONFLICT DO NOTHING;
