-- CEO Organization: department tasks, weekly goals, ability proposals, recommended actions

CREATE TABLE IF NOT EXISTS ceo_org_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy', 'marketing', 'development', 'research')),
  title TEXT NOT NULL,
  description TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'approved', 'rejected')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('weekly_plan', 'daily_check', 'department', 'manual', 'ceo_directive')),
  assigned_by TEXT,
  result_summary TEXT,
  result_file_path TEXT,
  week_label TEXT,
  due_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_org_tasks_user_dept_status ON ceo_org_tasks (user_id, department_slug, status);
CREATE INDEX IF NOT EXISTS idx_ceo_org_tasks_user_week ON ceo_org_tasks (user_id, week_label);

CREATE TABLE IF NOT EXISTS ceo_weekly_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_label TEXT NOT NULL,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy', 'marketing', 'development', 'research')),
  goal_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ceo_weekly_goals_unique
  ON ceo_weekly_goals (user_id, week_label, department_slug);

CREATE TABLE IF NOT EXISTS ceo_ability_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy', 'marketing', 'development', 'research')),
  title TEXT NOT NULL,
  description TEXT,
  rationale TEXT,
  estimated_effort TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'implemented')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ceo_recommended_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_slug TEXT NOT NULL CHECK (department_slug IN ('economy', 'marketing', 'development', 'research')),
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
