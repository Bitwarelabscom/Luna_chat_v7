-- Luna Chat Settings Schema
-- Saved system prompts and settings enhancements

-- Saved system prompts for users
CREATE TABLE IF NOT EXISTS saved_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    base_prompt TEXT NOT NULL,
    assistant_additions TEXT,
    companion_additions TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_prompts_user_id ON saved_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_default ON saved_prompts(user_id, is_default);

-- Updated_at trigger for saved_prompts
DROP TRIGGER IF EXISTS update_saved_prompts_updated_at ON saved_prompts;
CREATE TRIGGER update_saved_prompts_updated_at
    BEFORE UPDATE ON saved_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add active_prompt_id to users table for custom prompt selection
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_prompt_id UUID REFERENCES saved_prompts(id) ON DELETE SET NULL;
