-- Migration: 044_voice_luna.sql
-- Description: Add Voice Luna tables for fast voice chat (separate from main Luna)

-- Voice sessions (separate from regular Luna sessions)
CREATE TABLE IF NOT EXISTS voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) DEFAULT 'Voice Session',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(user_id);

-- Voice messages (separate from regular chat messages)
CREATE TABLE IF NOT EXISTS voice_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_results JSONB,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_messages_session_id ON voice_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_voice_messages_created_at ON voice_messages(created_at);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS voice_sessions_updated_at ON voice_sessions;
CREATE TRIGGER voice_sessions_updated_at
  BEFORE UPDATE ON voice_sessions
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();
