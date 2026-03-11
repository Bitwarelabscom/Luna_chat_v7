-- Migration: Switch from Ollama BGE-M3 to OpenRouter Qwen3 Embedding 8B
-- Using dimensions=1024 (Matryoshka) to match existing schema - no column changes needed.
-- Existing embeddings will have slightly different values from BGE-M3 vs Qwen3 but
-- cosine similarity still works across the mixed set. New embeddings will gradually
-- replace old ones as messages are created.
--
-- If you want to use full 4096 dimensions for better quality, uncomment the block
-- below and re-embed all data using the re-embedding script.

-- OPTIONAL: Uncomment below to switch to a different dimension (e.g. 4096)
-- WARNING: This truncates all existing embeddings. Run the re-embedding script after.
/*
TRUNCATE message_embeddings;
TRUNCATE conversation_summaries;
DELETE FROM knowledge_items WHERE embedding IS NOT NULL;
DELETE FROM document_chunks WHERE embedding IS NOT NULL;
DELETE FROM email_cache WHERE embedding IS NOT NULL;
DELETE FROM user_topic_interests WHERE embedding IS NOT NULL;
DELETE FROM workspace_embeddings;
DELETE FROM knowledge_gaps WHERE embedding IS NOT NULL;

DROP INDEX IF EXISTS idx_message_embeddings_vector;
DROP INDEX IF EXISTS idx_conversation_summaries_vector;
DROP INDEX IF EXISTS idx_knowledge_items_embedding;
DROP INDEX IF EXISTS idx_document_chunks_embedding;
DROP INDEX IF EXISTS idx_email_cache_embedding;
DROP INDEX IF EXISTS idx_user_topic_interests_embedding;
DROP INDEX IF EXISTS idx_workspace_embeddings_vector;
DROP INDEX IF EXISTS idx_knowledge_gaps_embedding;

ALTER TABLE message_embeddings ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE conversation_summaries ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE knowledge_items ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE email_cache ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE user_topic_interests ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE workspace_embeddings ALTER COLUMN embedding TYPE vector(4096);
ALTER TABLE knowledge_gaps ALTER COLUMN embedding TYPE vector(4096);

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
CREATE INDEX IF NOT EXISTS idx_workspace_embeddings_vector ON workspace_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_embedding ON knowledge_gaps
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
*/

-- No-op migration marker (model change is config-only when keeping 1024 dims)
SELECT 1;
