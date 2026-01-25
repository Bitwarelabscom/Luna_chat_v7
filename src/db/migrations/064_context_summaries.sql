-- Context Summaries - Metadata and Corrections
-- Supports on-demand context loading via Redis-stored summaries

-- Metadata tracking for analytics and maintenance
CREATE TABLE context_summary_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary_type VARCHAR(20) NOT NULL CHECK (summary_type IN ('session', 'intent')),
    reference_id UUID NOT NULL,
    redis_key VARCHAR(255) NOT NULL,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    keywords TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique combination per user
    CONSTRAINT context_summary_metadata_unique
        UNIQUE (user_id, summary_type, reference_id)
);

-- Index for cleanup queries
CREATE INDEX idx_context_summary_expires ON context_summary_metadata(expires_at)
    WHERE expires_at IS NOT NULL;

-- Index for user lookups
CREATE INDEX idx_context_summary_user ON context_summary_metadata(user_id, summary_type);


-- User corrections log for tracking when users correct stored context
CREATE TABLE context_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary_type VARCHAR(20) NOT NULL CHECK (summary_type IN ('session', 'intent')),
    reference_id UUID NOT NULL,
    field_corrected VARCHAR(50) NOT NULL,
    original_value TEXT,
    corrected_value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analytics queries
CREATE INDEX idx_context_corrections_user ON context_corrections(user_id, created_at DESC);


-- Cleanup function for old metadata
CREATE OR REPLACE FUNCTION cleanup_context_summary_metadata()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM context_summary_metadata
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- Comment on tables
COMMENT ON TABLE context_summary_metadata IS 'Tracks Redis-stored context summaries for analytics and maintenance';
COMMENT ON TABLE context_corrections IS 'Logs user corrections to stored context summaries';
