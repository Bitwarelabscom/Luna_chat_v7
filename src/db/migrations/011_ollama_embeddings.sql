-- Migration: Switch from OpenAI text-embedding-3-small (1536 dims) to Ollama bge-m3 (1024 dims)
-- This migration clears existing embeddings and updates vector dimensions

-- Clear existing embeddings (incompatible dimensions)
TRUNCATE message_embeddings;
TRUNCATE conversation_summaries;
DELETE FROM knowledge_items WHERE embedding IS NOT NULL;
DELETE FROM document_chunks WHERE embedding IS NOT NULL;
DELETE FROM email_cache WHERE embedding IS NOT NULL;
DELETE FROM user_topic_interests WHERE embedding IS NOT NULL;

-- Drop existing indexes
DROP INDEX IF EXISTS idx_message_embeddings_vector;
DROP INDEX IF EXISTS idx_conversation_summaries_vector;
DROP INDEX IF EXISTS idx_knowledge_items_embedding;
DROP INDEX IF EXISTS idx_document_chunks_embedding;
DROP INDEX IF EXISTS idx_email_cache_embedding;
DROP INDEX IF EXISTS idx_user_topic_interests_embedding;

-- Alter vector columns to new dimension (1024 for bge-m3)
ALTER TABLE message_embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE conversation_summaries ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE knowledge_items ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE email_cache ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE user_topic_interests ALTER COLUMN embedding TYPE vector(1024);

-- Recreate indexes with new dimensions
CREATE INDEX idx_message_embeddings_vector ON message_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_conversation_summaries_vector ON conversation_summaries
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_embedding ON knowledge_items
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_email_cache_embedding ON email_cache
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_user_topic_interests_embedding ON user_topic_interests
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
