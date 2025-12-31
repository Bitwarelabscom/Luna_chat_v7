-- Auto Trading Mode
-- Automated trading based on RSI + Volume signals with risk safeguards

-- Auto trading settings per user
CREATE TABLE IF NOT EXISTS auto_trading_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  enabled BOOLEAN DEFAULT false,
  max_positions INTEGER DEFAULT 3,
  rsi_threshold DECIMAL(5,2) DEFAULT 30,
  volume_multiplier DECIMAL(5,2) DEFAULT 1.5,
  min_position_pct DECIMAL(5,2) DEFAULT 2,
  max_position_pct DECIMAL(5,2) DEFAULT 5,
  daily_loss_limit_pct DECIMAL(5,2) DEFAULT 5,
  max_consecutive_losses INTEGER DEFAULT 3,
  symbol_cooldown_minutes INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto trading daily state (resets daily)
CREATE TABLE IF NOT EXISTS auto_trading_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  date DATE DEFAULT CURRENT_DATE,
  is_paused BOOLEAN DEFAULT false,
  pause_reason TEXT,
  daily_pnl_usd DECIMAL(20,8) DEFAULT 0,
  daily_pnl_pct DECIMAL(10,4) DEFAULT 0,
  consecutive_losses INTEGER DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  wins_count INTEGER DEFAULT 0,
  losses_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Symbol cooldowns
CREATE TABLE IF NOT EXISTS auto_trading_cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  symbol VARCHAR(20),
  cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- Track which trades are from auto mode
ALTER TABLE trades ADD COLUMN IF NOT EXISTS auto_trade BOOLEAN DEFAULT false;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auto_trading_settings_user ON auto_trading_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trading_state_user_date ON auto_trading_state(user_id, date);
CREATE INDEX IF NOT EXISTS idx_auto_trading_cooldowns_user ON auto_trading_cooldowns(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_auto_trade ON trades(auto_trade) WHERE auto_trade = true;
