-- File-to-Editor document mappings
-- Maps filesystem files (workspace/project) to Y.js editor documents

CREATE TABLE IF NOT EXISTS file_editor_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  source_type VARCHAR(20) NOT NULL,  -- 'workspace' | 'project'
  source_id VARCHAR(255) NOT NULL,   -- filename or projectId:filename
  editor_document_id VARCHAR(255) NOT NULL,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_file_editor_mappings_lookup
  ON file_editor_mappings(user_id, source_type, source_id);
