-- Context Compression Support
-- Enables rolling summarization of older messages and smarter history selection

-- Rolling summary storage on sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rolling_summary TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary_cutoff_message_id UUID REFERENCES messages(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_summarized_at TIMESTAMPTZ;

-- Track tool messages for stripping in compression
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_tool_message BOOLEAN DEFAULT false;

-- Index for efficient message retrieval by session and time
CREATE INDEX IF NOT EXISTS idx_messages_session_created_desc
ON messages(session_id, created_at DESC);

-- Comment for documentation
COMMENT ON COLUMN sessions.rolling_summary IS 'Compressed summary of messages older than the verbatim window';
COMMENT ON COLUMN sessions.summary_cutoff_message_id IS 'Oldest message ID still in verbatim window (messages before this are summarized)';
COMMENT ON COLUMN sessions.last_summarized_at IS 'Timestamp of last summary generation';
COMMENT ON COLUMN messages.is_tool_message IS 'True if message contains tool call/result (for compression stripping)';
