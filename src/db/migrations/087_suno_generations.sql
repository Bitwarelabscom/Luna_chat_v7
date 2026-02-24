-- Suno ambient music generation tracking
CREATE TABLE suno_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(300) NOT NULL DEFAULT 'Generating...',
  style TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  key VARCHAR(20),
  n8n_task_id VARCHAR(200),
  suno_id VARCHAR(200),
  audio_url TEXT,
  file_path VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_suno_generations_user ON suno_generations(user_id, status, created_at DESC);
CREATE INDEX idx_suno_generations_task ON suno_generations(n8n_task_id);
