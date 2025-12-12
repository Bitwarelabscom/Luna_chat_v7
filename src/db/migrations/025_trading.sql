-- Migration: 025_trading.sql
-- Description: Add trading tables for Trader Luna feature

-- User encrypted API keys for exchange connections
CREATE TABLE IF NOT EXISTS user_trading_keys (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  exchange VARCHAR(50) DEFAULT 'binance',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trading sessions (separate from regular Luna sessions)
CREATE TABLE IF NOT EXISTS trading_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) DEFAULT 'Trading Session',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);

-- Trading messages (separate from regular chat messages)
CREATE TABLE IF NOT EXISTS trading_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_results JSONB,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_messages_session_id ON trading_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_trading_messages_created_at ON trading_messages(created_at);

-- Trading risk settings per user
CREATE TABLE IF NOT EXISTS trading_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  binance_connected BOOLEAN DEFAULT false,
  max_position_pct DECIMAL(5,2) DEFAULT 10.00,        -- Max % of portfolio per trade
  daily_loss_limit_pct DECIMAL(5,2) DEFAULT 5.00,     -- Stop trading after X% daily loss
  require_stop_loss BOOLEAN DEFAULT true,              -- Force stop-loss on all orders
  default_stop_loss_pct DECIMAL(5,2) DEFAULT 2.00,    -- Default stop-loss percentage
  allowed_symbols TEXT[] DEFAULT ARRAY['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'],
  risk_tolerance VARCHAR(20) DEFAULT 'moderate' CHECK (risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot configurations
CREATE TABLE IF NOT EXISTS trading_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('grid', 'dca', 'rsi', 'ma_crossover', 'custom')),
  symbol VARCHAR(20) NOT NULL,                         -- e.g., BTCUSDT
  config JSONB NOT NULL DEFAULT '{}',                  -- Strategy parameters
  status VARCHAR(20) DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'error', 'paused')),
  last_error TEXT,
  total_profit DECIMAL(20,8) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trading_bots_user_id ON trading_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_bots_status ON trading_bots(status);

-- Bot execution logs (also used for order monitor system logs when bot_id is NULL)
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID REFERENCES trading_bots(id) ON DELETE CASCADE,  -- NULL for system/order monitor logs
  action VARCHAR(50) NOT NULL,                         -- buy, sell, error, status_change, signal, order_monitor_*
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_id ON bot_logs(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at);

-- Trade history (manual and bot trades)
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id UUID REFERENCES trading_bots(id) ON DELETE SET NULL, -- NULL for manual trades
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('market', 'limit', 'stop_loss', 'take_profit')),
  quantity DECIMAL(20,8) NOT NULL,
  price DECIMAL(20,8),                                 -- NULL for market orders until filled
  filled_price DECIMAL(20,8),                          -- Actual fill price
  total DECIMAL(20,8),
  fee DECIMAL(20,8) DEFAULT 0,
  fee_asset VARCHAR(10),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'partially_filled', 'cancelled', 'rejected', 'expired')),
  binance_order_id VARCHAR(100),
  stop_loss_price DECIMAL(20,8),
  take_profit_price DECIMAL(20,8),
  -- Trailing stop loss fields
  trailing_stop_pct DECIMAL(5,2),                      -- Trailing stop percentage (e.g., 2.5 = 2.5%)
  trailing_stop_price DECIMAL(20,8),                   -- Current trailing stop price
  trailing_stop_highest DECIMAL(20,8),                 -- Highest price seen since entry
  -- Position close tracking
  closed_at TIMESTAMPTZ,                               -- When position was closed
  close_price DECIMAL(20,8),                           -- Price at which position was closed
  close_reason VARCHAR(50),                            -- stop_loss, take_profit, trailing_stop, manual
  close_order_id VARCHAR(100),                         -- Binance order ID for the close trade
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

-- Price alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  condition VARCHAR(10) NOT NULL CHECK (condition IN ('above', 'below', 'crosses')),
  target_price DECIMAL(20,8) NOT NULL,
  triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  notification_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_price_alerts_triggered ON price_alerts(triggered);

-- Cached portfolio snapshots (for performance tracking)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_value_usdt DECIMAL(20,2) NOT NULL,
  holdings JSONB NOT NULL,                             -- Snapshot of all holdings
  daily_pnl DECIMAL(20,2),
  daily_pnl_pct DECIMAL(8,4),
  snapshot_time TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_id ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_time ON portfolio_snapshots(snapshot_time);

-- Conditional orders (price-triggered trades)
CREATE TABLE IF NOT EXISTS conditional_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  condition VARCHAR(20) NOT NULL CHECK (condition IN ('above', 'below', 'crosses_up', 'crosses_down')),
  trigger_price DECIMAL(20,8) NOT NULL,
  action JSONB NOT NULL,                               -- {side, type, amountType, amount, stopLoss, takeProfit, trailingStopPct, trailingStopDollar}
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled', 'expired')),
  last_price DECIMAL(20,8),                            -- For cross detection
  triggered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conditional_orders_user_id ON conditional_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_conditional_orders_status ON conditional_orders(status);
CREATE INDEX IF NOT EXISTS idx_conditional_orders_symbol ON conditional_orders(symbol);

-- Trading recommendations from Luna
CREATE TABLE IF NOT EXISTS trading_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES trading_sessions(id) ON DELETE SET NULL,
  symbol VARCHAR(20) NOT NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('buy', 'sell', 'hold', 'watch')),
  entry_price DECIMAL(20,8),
  stop_loss DECIMAL(20,8),
  take_profit DECIMAL(20,8),
  confidence VARCHAR(20) CHECK (confidence IN ('low', 'medium', 'high')),
  reasoning TEXT,
  followed BOOLEAN DEFAULT false,
  outcome VARCHAR(20),                                 -- profit, loss, pending, expired
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trading_recommendations_user_id ON trading_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_recommendations_symbol ON trading_recommendations(symbol);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_trading_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS trading_sessions_updated_at ON trading_sessions;
CREATE TRIGGER trading_sessions_updated_at
  BEFORE UPDATE ON trading_sessions
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();

DROP TRIGGER IF EXISTS trading_settings_updated_at ON trading_settings;
CREATE TRIGGER trading_settings_updated_at
  BEFORE UPDATE ON trading_settings
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();

DROP TRIGGER IF EXISTS trading_bots_updated_at ON trading_bots;
CREATE TRIGGER trading_bots_updated_at
  BEFORE UPDATE ON trading_bots
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();
