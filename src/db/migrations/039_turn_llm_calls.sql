-- Turn LLM Calls - Track individual LLM calls within layered agent turns
-- Enables per-message token breakdown and cost tracking

-- ============================================
-- LLM Call Tracking Table
-- ============================================

CREATE TABLE IF NOT EXISTS turn_llm_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id UUID NOT NULL,  -- References agent_turns.turn_id
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- Call identification
    node_name TEXT NOT NULL,  -- plan, draft, critique, repair
    call_sequence INTEGER NOT NULL,  -- Order within turn (1, 2, 3...)

    -- Model info
    provider TEXT NOT NULL,
    model TEXT NOT NULL,

    -- Token tracking
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    reasoning_tokens INTEGER DEFAULT 0,  -- For xAI Grok thinking output

    -- Cost (calculated at write time using MODEL_COSTS)
    estimated_cost DECIMAL(10, 6) DEFAULT 0,

    -- Performance
    duration_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_turn_llm_calls_turn ON turn_llm_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_turn_llm_calls_session ON turn_llm_calls(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_llm_calls_user ON turn_llm_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_llm_calls_created ON turn_llm_calls(created_at);

-- ============================================
-- Extend agent_turns with Summary Columns
-- ============================================

ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS total_input_tokens INTEGER DEFAULT 0;
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS total_output_tokens INTEGER DEFAULT 0;
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS total_cache_tokens INTEGER DEFAULT 0;
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0;
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10, 6) DEFAULT 0;
ALTER TABLE agent_turns ADD COLUMN IF NOT EXISTS llm_call_count INTEGER DEFAULT 0;

-- ============================================
-- Aggregation View
-- ============================================

CREATE OR REPLACE VIEW turn_token_summary AS
SELECT
    t.turn_id,
    t.session_id,
    t.created_at,
    COALESCE(SUM(c.input_tokens), 0) as total_input_tokens,
    COALESCE(SUM(c.output_tokens), 0) as total_output_tokens,
    COALESCE(SUM(c.cache_tokens), 0) as total_cache_tokens,
    COALESCE(SUM(c.total_tokens), 0) as total_tokens,
    COALESCE(SUM(c.estimated_cost), 0) as total_cost,
    COUNT(c.id) as llm_call_count,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'node', c.node_name,
                'model', c.model,
                'provider', c.provider,
                'input', c.input_tokens,
                'output', c.output_tokens,
                'cache', c.cache_tokens,
                'cost', c.estimated_cost,
                'duration', c.duration_ms,
                'reasoning', c.reasoning_tokens
            ) ORDER BY c.call_sequence
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::jsonb
    ) as call_breakdown
FROM agent_turns t
LEFT JOIN turn_llm_calls c ON t.turn_id = c.turn_id
GROUP BY t.turn_id, t.session_id, t.created_at;

-- ============================================
-- Daily Token Stats by Node Type
-- ============================================

CREATE OR REPLACE VIEW daily_turn_token_stats AS
SELECT
    DATE_TRUNC('day', created_at) as day,
    user_id,
    node_name,
    provider,
    model,
    COUNT(*) as call_count,
    SUM(input_tokens) as total_input,
    SUM(output_tokens) as total_output,
    SUM(cache_tokens) as total_cache,
    SUM(total_tokens) as total_tokens,
    SUM(estimated_cost) as total_cost,
    ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms
FROM turn_llm_calls
GROUP BY DATE_TRUNC('day', created_at), user_id, node_name, provider, model
ORDER BY day DESC, user_id, node_name;
