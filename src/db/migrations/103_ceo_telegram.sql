-- CEO Telegram Bot - connection and link code tables
-- Mirrors trading_telegram_connections / trading_telegram_link_codes pattern

CREATE TABLE IF NOT EXISTS ceo_telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ceo_telegram_conn_user ON ceo_telegram_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_ceo_telegram_conn_chat ON ceo_telegram_connections(chat_id);

CREATE TABLE IF NOT EXISTS ceo_telegram_link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceo_telegram_link_user ON ceo_telegram_link_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_ceo_telegram_link_code ON ceo_telegram_link_codes(code);
