-- Migration 041: Bot Enhancements
-- Adds support for new bot types, market_type for Alpha trading, and enhanced conditional orders

-- Update bot types constraint to include new strategies
ALTER TABLE trading_bots DROP CONSTRAINT IF EXISTS trading_bots_type_check;
ALTER TABLE trading_bots ADD CONSTRAINT trading_bots_type_check
  CHECK (type IN ('grid', 'dca', 'rsi', 'ma_crossover', 'macd', 'breakout', 'mean_reversion', 'momentum', 'custom'));

-- Add market_type to trading_bots for Alpha token support
ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS market_type VARCHAR(10) DEFAULT 'spot';
ALTER TABLE trading_bots ADD CONSTRAINT trading_bots_market_type_check
  CHECK (market_type IN ('spot', 'alpha'));

-- Add market_type to trades for Alpha token support
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_type VARCHAR(10) DEFAULT 'spot';
ALTER TABLE trades ADD CONSTRAINT trades_market_type_check
  CHECK (market_type IN ('spot', 'alpha'));

-- Add market_type to conditional_orders for Alpha token support
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS market_type VARCHAR(10) DEFAULT 'spot';
ALTER TABLE conditional_orders ADD CONSTRAINT conditional_orders_market_type_check
  CHECK (market_type IN ('spot', 'alpha'));

-- Add index for faster bot queries by market_type
CREATE INDEX IF NOT EXISTS idx_trading_bots_market_type ON trading_bots(market_type);
CREATE INDEX IF NOT EXISTS idx_trades_market_type ON trades(market_type);
CREATE INDEX IF NOT EXISTS idx_conditional_orders_market_type ON conditional_orders(market_type);
