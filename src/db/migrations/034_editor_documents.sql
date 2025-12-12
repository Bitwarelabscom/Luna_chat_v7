-- Editor documents for collaborative editing
-- Y.js document state is stored as binary

CREATE TABLE IF NOT EXISTS editor_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  content BYTEA,
  title VARCHAR(255),
  user_id UUID REFERENCES users(id),
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster document lookups
CREATE INDEX IF NOT EXISTS idx_editor_documents_name ON editor_documents(name);
CREATE INDEX IF NOT EXISTS idx_editor_documents_user_id ON editor_documents(user_id);

-- Document collaborators (for sharing)
CREATE TABLE IF NOT EXISTS editor_document_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES editor_documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  permission VARCHAR(20) DEFAULT 'edit', -- 'view', 'edit', 'admin'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_editor_collaborators_document ON editor_document_collaborators(document_id);
CREATE INDEX IF NOT EXISTS idx_editor_collaborators_user ON editor_document_collaborators(user_id);
