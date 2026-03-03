-- Agent User Overrides: Per-user customization of builtin agents
-- Custom agents: builtin_parent_id=NULL, user_id=<userId>
-- Builtin overrides: builtin_parent_id='companion', user_id=<userId>

ALTER TABLE agent_definitions ADD COLUMN IF NOT EXISTS builtin_parent_id TEXT;

-- Each user can have at most one override per builtin agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_defs_user_override
  ON agent_definitions(user_id, builtin_parent_id)
  WHERE builtin_parent_id IS NOT NULL AND user_id IS NOT NULL;
