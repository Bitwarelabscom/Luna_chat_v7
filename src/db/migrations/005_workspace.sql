-- Luna Chat Workspace Schema
-- Adds: Persistent file storage for user scripts and documents

-- ============================================
-- WORKSPACE FILES
-- ============================================
CREATE TABLE IF NOT EXISTS workspace_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_workspace_user ON workspace_files(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_filename ON workspace_files(user_id, filename);

-- ============================================
-- TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS update_workspace_files_updated_at ON workspace_files;
CREATE TRIGGER update_workspace_files_updated_at
    BEFORE UPDATE ON workspace_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
