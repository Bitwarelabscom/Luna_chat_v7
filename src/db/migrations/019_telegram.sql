-- ============================================
-- TELEGRAM INTEGRATION MIGRATION
-- Luna can send messages via Telegram bot
-- ============================================

-- Store user's Telegram connection
CREATE TABLE IF NOT EXISTS telegram_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,  -- Telegram chat ID
    username VARCHAR(100),     -- Telegram username (optional)
    first_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_connections_user ON telegram_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_connections_chat ON telegram_connections(chat_id);

-- Add telegram as delivery method option
ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS enable_telegram BOOLEAN DEFAULT false;

ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS persist_telegram_to_chat BOOLEAN DEFAULT true;

-- Add telegram to pending triggers delivery options
-- (delivery_method column already supports 'telegram' as a string value)

-- Link codes for connecting Telegram (temporary, expires)
CREATE TABLE IF NOT EXISTS telegram_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_code ON telegram_link_codes(code);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON telegram_link_codes(user_id);

-- Clean up expired link codes
CREATE OR REPLACE FUNCTION cleanup_expired_telegram_codes()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM telegram_link_codes
    WHERE expires_at < NOW() AND used_at IS NULL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
