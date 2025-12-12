-- MCP Stdio Transport Support
-- Adds support for stdio-based MCP servers (command execution via stdin/stdout)

-- Add transport type column (http or stdio)
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS transport_type VARCHAR(20) DEFAULT 'http';

-- Add stdio-specific columns
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS command_path TEXT;
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS command_args JSONB DEFAULT '[]';
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS env_vars JSONB DEFAULT '{}';
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS working_directory TEXT;

-- Make url optional (only required for http transport)
ALTER TABLE mcp_servers ALTER COLUMN url DROP NOT NULL;

-- Add check constraint for transport type
ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_transport_check;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_transport_check
  CHECK (
    (transport_type = 'http' AND url IS NOT NULL) OR
    (transport_type = 'stdio' AND command_path IS NOT NULL)
  );

-- Index for transport type queries
CREATE INDEX IF NOT EXISTS idx_mcp_servers_transport ON mcp_servers(transport_type);
