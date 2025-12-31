-- Migration: 052_crypto_com_exchange.sql
-- Description: Add Crypto.com exchange support with margin trading

-- Add margin fields to user_trading_keys
ALTER TABLE user_trading_keys
ADD COLUMN IF NOT EXISTS margin_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS leverage INTEGER DEFAULT 1 CHECK (leverage >= 1 AND leverage <= 10);

-- Add index for exchange type queries
CREATE INDEX IF NOT EXISTS idx_user_trading_keys_exchange ON user_trading_keys(exchange);

-- Make trading_settings exchange-agnostic
-- First add new columns
ALTER TABLE trading_settings
ADD COLUMN IF NOT EXISTS exchange_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS active_exchange VARCHAR(50) DEFAULT NULL;

-- Migrate existing data: if binance_connected was true, set exchange_connected and active_exchange
UPDATE trading_settings
SET exchange_connected = binance_connected,
    active_exchange = CASE WHEN binance_connected THEN 'binance' ELSE NULL END
WHERE binance_connected IS NOT NULL;

-- Now we can drop the old column (do this in a separate migration for safety, but including here for completeness)
-- ALTER TABLE trading_settings DROP COLUMN IF EXISTS binance_connected;
-- For now, keep both columns for backward compatibility

-- Add exchange and margin fields to trades table
ALTER TABLE trades
ADD COLUMN IF NOT EXISTS exchange VARCHAR(50) DEFAULT 'binance',
ADD COLUMN IF NOT EXISTS margin_mode VARCHAR(10) DEFAULT 'SPOT' CHECK (margin_mode IN ('SPOT', 'MARGIN')),
ADD COLUMN IF NOT EXISTS leverage INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS liquidation_price DECIMAL(20,8),
ADD COLUMN IF NOT EXISTS margin_interest DECIMAL(20,8) DEFAULT 0;

-- Create index for exchange on trades
CREATE INDEX IF NOT EXISTS idx_trades_exchange ON trades(exchange);

-- Create margin_positions table for tracking open margin positions
CREATE TABLE IF NOT EXISTS margin_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange VARCHAR(50) NOT NULL DEFAULT 'crypto_com',
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('long', 'short')),
  entry_price DECIMAL(20,8) NOT NULL,
  quantity DECIMAL(20,8) NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1 CHECK (leverage >= 1 AND leverage <= 10),
  liquidation_price DECIMAL(20,8),
  unrealized_pnl DECIMAL(20,8) DEFAULT 0,
  margin_used DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_price DECIMAL(20,8),
  realized_pnl DECIMAL(20,8),
  trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
  close_trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_margin_positions_user_id ON margin_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_margin_positions_status ON margin_positions(status);
CREATE INDEX IF NOT EXISTS idx_margin_positions_symbol ON margin_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_margin_positions_exchange ON margin_positions(exchange);

-- Create trigger for margin_positions updated_at
DROP TRIGGER IF EXISTS margin_positions_updated_at ON margin_positions;
CREATE TRIGGER margin_positions_updated_at
  BEFORE UPDATE ON margin_positions
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();

-- Track exchange API rate limits (optional, for future use)
CREATE TABLE IF NOT EXISTS exchange_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange VARCHAR(50) NOT NULL,
  endpoint VARCHAR(100) NOT NULL,
  request_count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exchange, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rate_limits_user ON exchange_rate_limits(user_id, exchange);
