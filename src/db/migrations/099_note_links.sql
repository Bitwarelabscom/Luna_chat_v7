-- Migration 099: note_links
-- Tracks wiki-style [[links]] between workspace files for PKM graph traversal

CREATE TABLE IF NOT EXISTS note_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_file VARCHAR(500) NOT NULL,
  target_file VARCHAR(500) NOT NULL,
  link_text VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source_file, target_file, link_text)
);

CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(user_id, source_file);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(user_id, target_file);
