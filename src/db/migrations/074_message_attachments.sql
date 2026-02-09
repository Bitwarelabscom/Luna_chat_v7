-- Migration 074: Message Attachments
-- Enable file uploads in chat by linking messages to documents

-- Junction table linking messages to documents
CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    attachment_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, document_id)
);

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);
CREATE INDEX idx_message_attachments_document ON message_attachments(document_id);

-- Store file analysis results in message for quick access
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_metadata JSONB;
