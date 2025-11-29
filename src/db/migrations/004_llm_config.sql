-- Luna Chat LLM Configuration Schema
-- Store user's model preferences for configurable tasks

-- User model configuration table
CREATE TABLE IF NOT EXISTS user_model_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL, -- 'main_chat', 'agent:researcher', 'agent:coder', etc.
    provider VARCHAR(20) NOT NULL,  -- 'openai', 'groq', 'anthropic', 'xai'
    model VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, task_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_model_config_user_id ON user_model_config(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_config_task_type ON user_model_config(task_type);

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_user_model_config_updated_at ON user_model_config;
CREATE TRIGGER update_user_model_config_updated_at
    BEFORE UPDATE ON user_model_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
