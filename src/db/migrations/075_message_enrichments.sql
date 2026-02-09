-- Migration 075: Add dual-LNN enrichment columns to message_embeddings
-- Supports thematic/relational analysis pipeline

ALTER TABLE message_embeddings
  ADD COLUMN IF NOT EXISTS emotional_valence FLOAT,
  ADD COLUMN IF NOT EXISTS attention_score FLOAT;

-- Index for filtering by high-attention messages during consolidation
CREATE INDEX IF NOT EXISTS idx_message_embeddings_attention
  ON message_embeddings (attention_score)
  WHERE attention_score IS NOT NULL;
