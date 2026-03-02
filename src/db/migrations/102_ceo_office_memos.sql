-- CEO Office Memos + Background Task Execution
-- Memos enable cross-department knowledge sharing
-- Background execution columns enable async task processing

-- ============================================================
-- ceo_memos table
-- ============================================================
CREATE TABLE IF NOT EXISTS ceo_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy','marketing','development','research','ceo')),
  memo_type TEXT NOT NULL DEFAULT 'status_update' CHECK (memo_type IN ('decision','insight','status_update','task_result')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  related_task_id UUID REFERENCES ceo_org_tasks(id) ON DELETE SET NULL,
  session_id UUID REFERENCES ceo_staff_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ceo_memos_user_dept ON ceo_memos (user_id, department_slug);
CREATE INDEX idx_ceo_memos_user_created ON ceo_memos (user_id, created_at DESC);

-- ============================================================
-- Add background execution columns to ceo_org_tasks
-- ============================================================
ALTER TABLE ceo_org_tasks
  ADD COLUMN IF NOT EXISTS execution_status TEXT CHECK (execution_status IN ('running','completed','failed')),
  ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggested_by TEXT CHECK (suggested_by IN ('manual','ceo_chat','department','weekly_plan'));

CREATE INDEX idx_ceo_org_tasks_execution ON ceo_org_tasks (user_id, execution_status) WHERE execution_status IS NOT NULL;
