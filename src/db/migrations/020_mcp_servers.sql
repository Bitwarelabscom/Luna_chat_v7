-- MCP (Model Context Protocol) Server Support
-- Allows Luna to connect to external MCP servers for additional tools

-- MCP Server Connections
CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    headers JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT true,
    is_connected BOOLEAN DEFAULT false,
    last_connected_at TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Cached MCP tools discovered from servers
CREATE TABLE IF NOT EXISTS mcp_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    title VARCHAR(255),
    description TEXT NOT NULL,
    input_schema JSONB NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(server_id, name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(user_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_enabled ON mcp_tools(server_id, is_enabled);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_mcp_servers_updated_at ON mcp_servers;
CREATE TRIGGER update_mcp_servers_updated_at
    BEFORE UPDATE ON mcp_servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mcp_tools_updated_at ON mcp_tools;
CREATE TRIGGER update_mcp_tools_updated_at
    BEFORE UPDATE ON mcp_tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
