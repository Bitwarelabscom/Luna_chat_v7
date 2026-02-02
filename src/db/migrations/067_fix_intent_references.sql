-- Fix Intent References
-- Drop custom intents table and repoint references to user_intents

-- Drop the duplicate table
DROP TABLE IF EXISTS intents CASCADE;

-- Update sessions table
-- Drop constraint if it exists (it might have been dropped by CASCADE above if named standardly, but let's be safe)
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_primary_intent_id_fkey;
ALTER TABLE sessions 
    ADD CONSTRAINT sessions_primary_intent_id_fkey 
    FOREIGN KEY (primary_intent_id) REFERENCES user_intents(id) ON DELETE SET NULL;

-- Update user_facts table
-- Drop the unique index we created in 066 because it depends on intent_id column
DROP INDEX IF EXISTS idx_user_facts_unique_intent;

ALTER TABLE user_facts DROP CONSTRAINT IF EXISTS user_facts_intent_id_fkey;
ALTER TABLE user_facts 
    ADD CONSTRAINT user_facts_intent_id_fkey 
    FOREIGN KEY (intent_id) REFERENCES user_intents(id) ON DELETE SET NULL;

-- Recreate the unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_facts_unique_intent 
ON user_facts (user_id, category, fact_key, COALESCE(intent_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Update message_embeddings table
ALTER TABLE message_embeddings DROP CONSTRAINT IF EXISTS message_embeddings_intent_id_fkey;
ALTER TABLE message_embeddings 
    ADD CONSTRAINT message_embeddings_intent_id_fkey 
    FOREIGN KEY (intent_id) REFERENCES user_intents(id) ON DELETE SET NULL;

-- Update conversation_summaries table
ALTER TABLE conversation_summaries DROP CONSTRAINT IF EXISTS conversation_summaries_intent_id_fkey;
ALTER TABLE conversation_summaries 
    ADD CONSTRAINT conversation_summaries_intent_id_fkey 
    FOREIGN KEY (intent_id) REFERENCES user_intents(id) ON DELETE SET NULL;
