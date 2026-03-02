-- Migration 101: CEO Proposals + Staff Chat
-- Adds approval flow for CEO Luna actions and department staff chat

-- ============================================================
-- CEO Proposals - everything CEO Luna wants to do requires approval
-- ============================================================
CREATE TABLE IF NOT EXISTS ceo_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('weekly_plan', 'task', 'goal', 'action', 'department_task')),
  title TEXT NOT NULL,
  description TEXT,
  department_slug TEXT,
  priority INTEGER DEFAULT 5,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('p1', 'p2', 'normal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  payload JSONB DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('weekly_plan', 'daily_check', 'chat_suggestion', 'manual')),
  session_id UUID,
  telegram_message_id BIGINT,
  expires_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ceo_proposals_user_status ON ceo_proposals (user_id, status);
CREATE INDEX idx_ceo_proposals_user_created ON ceo_proposals (user_id, created_at DESC);

-- ============================================================
-- Staff Chat Sessions - one per department per user
-- ============================================================
CREATE TABLE IF NOT EXISTS ceo_staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy', 'marketing', 'development', 'research', 'meeting')),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_ceo_staff_sessions_user_dept ON ceo_staff_sessions (user_id, department_slug);

-- ============================================================
-- Staff Chat Messages
-- ============================================================
CREATE TABLE IF NOT EXISTS ceo_staff_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ceo_staff_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  department_slug TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ceo_staff_messages_session ON ceo_staff_messages (session_id, created_at);
