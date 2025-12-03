-- Session Enhancements for Enhanced Autonomous Mode
-- Adds session mode, task description, task plan, and tool use tracking

-- ============================================
-- SESSION MODE AND TASK FIELDS
-- ============================================

-- Session mode: standard, expert_discussion, research
ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS session_mode VARCHAR(30) DEFAULT 'standard'
CHECK (session_mode IN ('standard', 'expert_discussion', 'research'));

-- Task description for task-focused sessions
ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS task_description TEXT;

-- Task plan generated during planning phase
ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS task_plan TEXT;

-- Tool use counter
ALTER TABLE autonomous_sessions
ADD COLUMN IF NOT EXISTS tool_use_count INTEGER DEFAULT 0;

-- ============================================
-- ADD PLANNING PHASE TO CURRENT_PHASE CHECK
-- ============================================

ALTER TABLE autonomous_sessions
DROP CONSTRAINT IF EXISTS autonomous_sessions_current_phase_check;

ALTER TABLE autonomous_sessions
ADD CONSTRAINT autonomous_sessions_current_phase_check
CHECK (current_phase IS NULL OR current_phase IN ('planning', 'polaris', 'aurora', 'vega', 'sol', 'act'));

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_sessions_mode
ON autonomous_sessions(session_mode);

CREATE INDEX IF NOT EXISTS idx_sessions_has_task
ON autonomous_sessions(user_id) WHERE task_description IS NOT NULL;
