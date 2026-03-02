-- Migration 100: workspace_search
-- Adds full-text search vector and content hash to workspace_files,
-- and a separate table for semantic embeddings per workspace file

-- Add tsvector column for full-text search
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_workspace_search ON workspace_files USING GIN(search_vector);

-- Separate table for workspace file embeddings
CREATE TABLE IF NOT EXISTS workspace_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(500) NOT NULL,
  embedding vector(1024),
  content_hash VARCHAR(64),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_workspace_embeddings_user ON workspace_embeddings(user_id);
