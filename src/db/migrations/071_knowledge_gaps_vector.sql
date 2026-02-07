-- Add embedding column to knowledge_gaps for semantic similarity checks
-- This allows detecting similar gaps and preventing redundant research

ALTER TABLE knowledge_gaps ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_vector ON knowledge_gaps 
USING ivfflat (embedding vector_cosine_ops) WITH (lists='10');
