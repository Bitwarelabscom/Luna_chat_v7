-- Migration 081: LLM Call Logs table for comprehensive usage tracking
-- Captures all non-Ollama/Sanhedrin LLM calls including background service calls
-- that are not tied to a session (startup greetings, mood analysis, sentiment, council)

CREATE TABLE IF NOT EXISTS llm_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  source VARCHAR(100) NOT NULL DEFAULT 'unknown',
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_tokens INT NOT NULL DEFAULT 0,
  reasoning_tokens INT NOT NULL DEFAULT 0,
  duration_ms INT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_call_logs_user_created ON llm_call_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_provider ON llm_call_logs(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_success ON llm_call_logs(success, created_at);
