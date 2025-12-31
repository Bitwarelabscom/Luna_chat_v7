-- Auto trading signal history - logs all detected signals for backtesting
CREATE TABLE IF NOT EXISTS auto_trading_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  symbol VARCHAR(20) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),

  -- Signal conditions at detection
  rsi DECIMAL(10,4) NOT NULL,
  volume_ratio DECIMAL(10,4) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  entry_price DECIMAL(20,8) NOT NULL,

  -- ATR-based targets at detection
  suggested_stop_loss DECIMAL(20,8),
  suggested_take_profit DECIMAL(20,8),
  atr_value DECIMAL(20,8),

  -- Execution status
  executed BOOLEAN DEFAULT false,
  trade_id UUID REFERENCES trades(id),
  skip_reason TEXT, -- 'cooldown', 'max_positions', 'insufficient_balance', etc.

  -- Backtest results (updated by background job)
  backtest_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'win', 'loss', 'timeout'
  backtest_exit_price DECIMAL(20,8),
  backtest_exit_at TIMESTAMPTZ,
  backtest_pnl_pct DECIMAL(10,4),
  backtest_duration_minutes INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auto_signals_user_time ON auto_trading_signals(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_signals_pending ON auto_trading_signals(backtest_status) WHERE backtest_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_auto_signals_symbol ON auto_trading_signals(symbol, detected_at DESC);
