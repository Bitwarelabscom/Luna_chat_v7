-- Create requests: friend submits a music idea, Claude Code generates an album
CREATE TABLE IF NOT EXISTS create_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  idea_text TEXT NOT NULL,
  production_id UUID REFERENCES album_productions(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_create_requests_user ON create_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_create_requests_status ON create_requests(status);

-- Invite codes: single-use, time-limited registration codes
CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id),
  used_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
