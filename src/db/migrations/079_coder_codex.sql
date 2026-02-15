-- Add Codex coder backend support to coder_settings

ALTER TABLE coder_settings
  ADD COLUMN IF NOT EXISTS codex_cli_enabled BOOLEAN DEFAULT false;

-- Ensure future rows include codex trigger defaults
ALTER TABLE coder_settings
  ALTER COLUMN trigger_words SET DEFAULT '{
    "claude": ["refactor", "security", "debug", "architecture", "critical", "production", "careful", "edge case"],
    "gemini": ["test", "explain", "analyze", "log", "simple", "script", "generate", "boilerplate", "documentation"],
    "api": [],
    "codex": ["quick fix","patch","codex","small refactor","fast"]
  }'::jsonb;

-- Ensure trigger_words always has a codex key
UPDATE coder_settings
SET trigger_words = jsonb_set(
  COALESCE(trigger_words, '{}'::jsonb),
  '{codex}',
  COALESCE(trigger_words->'codex', '["quick fix","patch","codex","small refactor","fast"]'::jsonb),
  true
);

-- Extend allowed default coder values
ALTER TABLE coder_settings
  DROP CONSTRAINT IF EXISTS coder_settings_default_coder_check;

ALTER TABLE coder_settings
  ADD CONSTRAINT coder_settings_default_coder_check
  CHECK (default_coder IN ('claude', 'gemini', 'api', 'codex'));
