-- Fix user_facts unique constraint to support intent scoping

-- Drop old constraint
ALTER TABLE user_facts DROP CONSTRAINT IF EXISTS user_facts_user_id_category_fact_key_key;

-- Create new unique index that treats NULL intent_id as a distinct value (using a zero UUID as placeholder for NULL in the index)
-- This ensures we can have (user, cat, key, intentA) AND (user, cat, key, NULL) but NOT two (user, cat, key, NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_facts_unique_intent 
ON user_facts (user_id, category, fact_key, COALESCE(intent_id, '00000000-0000-0000-0000-000000000000'::uuid));
