-- ============================================
-- TRADING TELEGRAM INTEGRATION MIGRATION
-- Separate Telegram bot for Trader Luna
-- ============================================

-- Store user's Trading Telegram connection (separate from main Luna)
CREATE TABLE IF NOT EXISTS trading_telegram_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    username VARCHAR(100),
    first_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trading_telegram_connections_user ON trading_telegram_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_telegram_connections_chat ON trading_telegram_connections(chat_id);

-- Link codes for connecting Trading Telegram
CREATE TABLE IF NOT EXISTS trading_telegram_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_telegram_link_codes_code ON trading_telegram_link_codes(code);
CREATE INDEX IF NOT EXISTS idx_trading_telegram_link_codes_user ON trading_telegram_link_codes(user_id);

-- Pending order confirmations (for Yes/No buttons)
CREATE TABLE IF NOT EXISTS pending_order_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL,
    order_type VARCHAR(10) NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8),
    stop_loss DECIMAL(20, 8),
    take_profit DECIMAL(20, 8),
    trailing_stop_pct DECIMAL(5, 2),
    message_id BIGINT,
    chat_id BIGINT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes'
);

CREATE INDEX IF NOT EXISTS idx_pending_orders_user ON pending_order_confirmations(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_orders_status ON pending_order_confirmations(status);

-- Clean up expired link codes
CREATE OR REPLACE FUNCTION cleanup_expired_trading_telegram_codes()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM trading_telegram_link_codes
    WHERE expires_at < NOW() AND used_at IS NULL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Clean up expired pending orders
CREATE OR REPLACE FUNCTION cleanup_expired_pending_orders()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    UPDATE pending_order_confirmations
    SET status = 'expired'
    WHERE expires_at < NOW() AND status = 'pending';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
