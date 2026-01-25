-- Intent Persistence System
-- Tracks active intents (what user is trying to accomplish) separately from memory
-- Enables understanding of ambiguous references, context across topic switches, and goal completion

-- Core intent table
CREATE TABLE IF NOT EXISTS user_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('task', 'goal', 'exploration', 'companion')),
    label VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'resolved', 'decayed')),
    priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_touched_at TIMESTAMPTZ DEFAULT NOW(),
    touch_count INTEGER DEFAULT 1,
    goal TEXT NOT NULL,
    constraints TEXT[] DEFAULT '{}',
    tried_approaches TEXT[] DEFAULT '{}',
    current_approach TEXT,
    blockers TEXT[] DEFAULT '{}',
    emotional_context TEXT,
    parent_intent_id UUID REFERENCES user_intents(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_type VARCHAR(20) CHECK (resolution_type IN ('completed', 'abandoned', 'merged', 'superseded')),
    source_session_id UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Intent relationships (for related/dependent intents)
CREATE TABLE IF NOT EXISTS intent_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_intent_id UUID NOT NULL REFERENCES user_intents(id) ON DELETE CASCADE,
    to_intent_id UUID NOT NULL REFERENCES user_intents(id) ON DELETE CASCADE,
    relation_type VARCHAR(20) NOT NULL CHECK (relation_type IN ('blocks', 'depends_on', 'related_to', 'supersedes')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_intent_id, to_intent_id, relation_type)
);

-- Intent touch history (for tracking engagement patterns)
CREATE TABLE IF NOT EXISTS intent_touches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id UUID NOT NULL REFERENCES user_intents(id) ON DELETE CASCADE,
    session_id UUID,
    message_snippet TEXT,
    touch_type VARCHAR(20) NOT NULL CHECK (touch_type IN ('explicit', 'implicit', 'progress', 'blocker', 'approach_change')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_intents_user_status ON user_intents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_intents_user_priority ON user_intents(user_id, priority);
CREATE INDEX IF NOT EXISTS idx_user_intents_last_touched ON user_intents(last_touched_at);
CREATE INDEX IF NOT EXISTS idx_user_intents_parent ON user_intents(parent_intent_id);
CREATE INDEX IF NOT EXISTS idx_intent_relations_from ON intent_relations(from_intent_id);
CREATE INDEX IF NOT EXISTS idx_intent_relations_to ON intent_relations(to_intent_id);
CREATE INDEX IF NOT EXISTS idx_intent_touches_intent ON intent_touches(intent_id, created_at);

-- Function to decay stale intents (called by daily job)
CREATE OR REPLACE FUNCTION decay_stale_intents(decay_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    -- Move active intents not touched in decay_days to 'decayed' status
    UPDATE user_intents
    SET status = 'decayed',
        updated_at = NOW()
    WHERE status = 'active'
      AND last_touched_at < NOW() - (decay_days || ' days')::INTERVAL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_intent_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS intent_timestamp_trigger ON user_intents;
CREATE TRIGGER intent_timestamp_trigger
    BEFORE UPDATE ON user_intents
    FOR EACH ROW
    EXECUTE FUNCTION update_intent_timestamp();

-- Function to enforce intent limits (max 5 active, max 3 high priority)
CREATE OR REPLACE FUNCTION enforce_intent_limits()
RETURNS TRIGGER AS $$
DECLARE
    active_count INTEGER;
    high_priority_count INTEGER;
BEGIN
    -- Only check on insert or when activating an intent
    IF NEW.status = 'active' THEN
        -- Count active intents for this user
        SELECT COUNT(*) INTO active_count
        FROM user_intents
        WHERE user_id = NEW.user_id
          AND status = 'active'
          AND id != NEW.id;

        -- Count high priority intents
        SELECT COUNT(*) INTO high_priority_count
        FROM user_intents
        WHERE user_id = NEW.user_id
          AND status = 'active'
          AND priority = 'high'
          AND id != NEW.id;

        -- If over limit, suspend oldest low-priority intent
        IF active_count >= 5 THEN
            UPDATE user_intents
            SET status = 'suspended',
                updated_at = NOW()
            WHERE id = (
                SELECT id FROM user_intents
                WHERE user_id = NEW.user_id
                  AND status = 'active'
                  AND id != NEW.id
                ORDER BY priority DESC, last_touched_at ASC
                LIMIT 1
            );
        END IF;

        -- If high priority exceeds 3, downgrade oldest high priority
        IF NEW.priority = 'high' AND high_priority_count >= 3 THEN
            UPDATE user_intents
            SET priority = 'medium',
                updated_at = NOW()
            WHERE id = (
                SELECT id FROM user_intents
                WHERE user_id = NEW.user_id
                  AND status = 'active'
                  AND priority = 'high'
                  AND id != NEW.id
                ORDER BY last_touched_at ASC
                LIMIT 1
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for enforcing limits
DROP TRIGGER IF EXISTS intent_limits_trigger ON user_intents;
CREATE TRIGGER intent_limits_trigger
    BEFORE INSERT OR UPDATE ON user_intents
    FOR EACH ROW
    EXECUTE FUNCTION enforce_intent_limits();
