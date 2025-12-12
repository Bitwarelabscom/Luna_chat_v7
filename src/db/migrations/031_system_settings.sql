-- System settings table for global configuration
-- Used for TTS settings and other system-wide configurations

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- Insert default TTS settings
INSERT INTO system_settings (key, value)
VALUES ('tts_settings', '{"engine": "elevenlabs", "openaiVoice": "nova"}')
ON CONFLICT (key) DO NOTHING;
