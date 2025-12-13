-- Coder Settings - User preferences for coding agents
-- Stores which coder backends are enabled and their configuration

CREATE TABLE IF NOT EXISTS coder_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Enable/disable flags for each coder backend
    claude_cli_enabled BOOLEAN DEFAULT false,
    gemini_cli_enabled BOOLEAN DEFAULT false,
    coder_api_enabled BOOLEAN DEFAULT false,

    -- Coder API configuration (when coder_api_enabled = true)
    coder_api_provider VARCHAR(20),
    coder_api_model VARCHAR(100),

    -- Custom trigger words (JSONB for flexibility)
    trigger_words JSONB DEFAULT '{
        "claude": ["refactor", "security", "debug", "architecture", "critical", "production", "careful", "edge case"],
        "gemini": ["test", "explain", "analyze", "log", "simple", "script", "generate", "boilerplate", "documentation"],
        "api": []
    }'::jsonb,

    -- Default/fallback coder when routing is ambiguous
    default_coder VARCHAR(20) DEFAULT 'claude' CHECK (default_coder IN ('claude', 'gemini', 'api')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_coder_settings_user_id ON coder_settings(user_id);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_coder_settings_updated_at ON coder_settings;
CREATE TRIGGER update_coder_settings_updated_at
    BEFORE UPDATE ON coder_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
