-- Migration 071: Execution Graph System for Project Planner
-- Replaces static project plans with executable DAGs (Directed Acyclic Graphs)
-- Each project is a graph of steps with explicit dependencies and execution state

-- Main execution projects table
CREATE TABLE IF NOT EXISTS execution_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    project_type VARCHAR(50) NOT NULL, -- 'python', 'javascript', 'fullstack', 'data', etc.
    status VARCHAR(50) NOT NULL DEFAULT 'ready', -- 'ready', 'executing', 'paused', 'completed', 'failed'
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    failed_steps INTEGER NOT NULL DEFAULT 0,
    redis_execution_key VARCHAR(255), -- Key for active execution state in Redis
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Individual execution steps in the DAG
CREATE TABLE IF NOT EXISTS execution_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES execution_projects(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    goal TEXT NOT NULL, -- What this step should accomplish
    action VARCHAR(50) NOT NULL, -- 'build', 'modify', 'run', 'test', 'deploy'
    artifact TEXT, -- Primary output file/resource produced
    agent_name VARCHAR(50), -- 'gemini-coder', 'claude-coder', 'python-runner', etc.
    agent_context TEXT, -- JSON context passed to agent
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'ready', 'in_progress', 'done', 'failed', 'blocked', 'awaiting_approval'
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    output TEXT, -- Agent output, stdout, generated code
    error_message TEXT,
    requires_approval BOOLEAN DEFAULT false,
    approval_reason TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    execution_time_ms INTEGER,
    UNIQUE(project_id, step_number)
);

-- DAG edges: which steps depend on which
CREATE TABLE IF NOT EXISTS step_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
    depends_on_step_id UUID NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
    dependency_type VARCHAR(50) DEFAULT 'requires', -- 'requires', 'optional', 'conditional'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(step_id, depends_on_step_id)
);

-- Artifacts produced by steps (files, test results, logs)
CREATE TABLE IF NOT EXISTS execution_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES execution_projects(id) ON DELETE CASCADE,
    artifact_type VARCHAR(50) NOT NULL, -- 'source_file', 'test_result', 'build_log', 'output'
    artifact_path TEXT, -- File path in workspace
    content TEXT, -- File content or result data
    mime_type VARCHAR(100),
    file_size INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Approval requests for structural/irreversible changes
CREATE TABLE IF NOT EXISTS step_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES execution_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_description TEXT NOT NULL,
    risk_level VARCHAR(50) NOT NULL, -- 'low', 'medium', 'high', 'critical'
    change_type VARCHAR(50) NOT NULL, -- 'structural', 'iterative', 'irreversible'
    affected_files TEXT[], -- Array of file paths that will be modified
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'expired'
    response_message TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

-- Add columns to existing projects table for migration path
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS migrated_to_execution_project UUID REFERENCES execution_projects(id),
ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT true;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_execution_projects_user_id ON execution_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_projects_status ON execution_projects(status);
CREATE INDEX IF NOT EXISTS idx_execution_projects_updated_at ON execution_projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_projects_session_id ON execution_projects(session_id);

CREATE INDEX IF NOT EXISTS idx_execution_steps_project_id ON execution_steps(project_id);
CREATE INDEX IF NOT EXISTS idx_execution_steps_project_step ON execution_steps(project_id, step_number);
CREATE INDEX IF NOT EXISTS idx_execution_steps_status ON execution_steps(project_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_steps_agent ON execution_steps(agent_name);

CREATE INDEX IF NOT EXISTS idx_step_dependencies_step_id ON step_dependencies(step_id);
CREATE INDEX IF NOT EXISTS idx_step_dependencies_depends_on ON step_dependencies(depends_on_step_id);

CREATE INDEX IF NOT EXISTS idx_execution_artifacts_step_id ON execution_artifacts(step_id);
CREATE INDEX IF NOT EXISTS idx_execution_artifacts_project_id ON execution_artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_execution_artifacts_type ON execution_artifacts(artifact_type);

CREATE INDEX IF NOT EXISTS idx_step_approval_requests_user_id ON step_approval_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_step_approval_requests_status ON step_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_step_approval_requests_created_at ON step_approval_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_step_approval_requests_project_id ON step_approval_requests(project_id);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_execution_project_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER execution_projects_updated_at
    BEFORE UPDATE ON execution_projects
    FOR EACH ROW
    EXECUTE FUNCTION update_execution_project_timestamp();

CREATE TRIGGER execution_steps_updated_at
    BEFORE UPDATE ON execution_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_execution_project_timestamp();

CREATE TRIGGER step_approval_requests_updated_at
    BEFORE UPDATE ON step_approval_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_execution_project_timestamp();

-- Add comments for documentation
COMMENT ON TABLE execution_projects IS 'Execution graph projects with DAG-based step dependencies';
COMMENT ON TABLE execution_steps IS 'Individual steps in execution graph with explicit dependencies';
COMMENT ON TABLE step_dependencies IS 'DAG edges defining which steps depend on which';
COMMENT ON TABLE execution_artifacts IS 'Files and outputs produced by execution steps';
COMMENT ON TABLE step_approval_requests IS 'Approval gates for structural/irreversible changes';

COMMENT ON COLUMN execution_projects.redis_execution_key IS 'Key for active execution state in Redis (24h TTL)';
COMMENT ON COLUMN execution_steps.agent_context IS 'JSON context passed to agent for execution';
COMMENT ON COLUMN step_approval_requests.expires_at IS 'Approval requests auto-expire after 24 hours';
