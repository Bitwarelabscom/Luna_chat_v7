-- Migration: 026_scalping.sql
-- Description: Add scalping bot with paper trading and learning system

-- Scalping settings per user
CREATE TABLE IF NOT EXISTS scalping_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,                    -- Scalping mode active
  mode VARCHAR(20) DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),  -- Paper trading by default
  max_position_usdt DECIMAL(20,2) DEFAULT 100,     -- Max position size per trade
  max_concurrent_positions INTEGER DEFAULT 3,       -- Max simultaneous positions
  symbols TEXT[] DEFAULT ARRAY['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  -- Rebound detection parameters
  min_drop_pct DECIMAL(5,2) DEFAULT 1.5,           -- Min price drop to consider
  max_drop_pct DECIMAL(5,2) DEFAULT 8.0,           -- Max drop (avoid falling knives)
  rsi_oversold_threshold INTEGER DEFAULT 30,        -- RSI threshold for entry
  volume_spike_multiplier DECIMAL(5,2) DEFAULT 2.0, -- Volume must be X times average
  min_confidence DECIMAL(5,2) DEFAULT 0.5,          -- Min confidence score to trade
  -- Exit parameters
  take_profit_pct DECIMAL(5,2) DEFAULT 1.0,        -- Target profit percentage
  stop_loss_pct DECIMAL(5,2) DEFAULT 0.5,          -- Stop loss percentage
  max_hold_minutes INTEGER DEFAULT 30,              -- Max time to hold position
  -- Learning thresholds
  min_trades_for_learning INTEGER DEFAULT 10,       -- Min trades before adjusting
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scalping opportunities detected by the bot
CREATE TABLE IF NOT EXISTS scalping_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  -- Market conditions at detection
  current_price DECIMAL(20,8) NOT NULL,
  price_drop_pct DECIMAL(8,4) NOT NULL,            -- How much price dropped
  rsi_value DECIMAL(5,2),
  volume_ratio DECIMAL(8,4),                       -- Current vs average volume
  -- Support/resistance context
  nearest_support DECIMAL(20,8),
  distance_to_support_pct DECIMAL(8,4),
  -- Confidence scoring
  confidence_score DECIMAL(5,4) NOT NULL,          -- 0-1 confidence
  signal_reasons JSONB NOT NULL DEFAULT '[]',      -- Why this was flagged
  -- Action taken
  action_taken VARCHAR(20) CHECK (action_taken IN ('paper_trade', 'live_trade', 'skipped', 'expired')),
  trade_id UUID,                                   -- Link to actual trade if executed
  -- Outcome tracking
  outcome VARCHAR(20),                             -- profit, loss, timeout, pending
  outcome_pct DECIMAL(8,4),                        -- Actual profit/loss %
  outcome_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scalping_opps_user ON scalping_opportunities(user_id);
CREATE INDEX IF NOT EXISTS idx_scalping_opps_symbol ON scalping_opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_scalping_opps_detected ON scalping_opportunities(detected_at);
CREATE INDEX IF NOT EXISTS idx_scalping_opps_outcome ON scalping_opportunities(outcome);

-- Paper trades (simulated trades for training)
CREATE TABLE IF NOT EXISTS paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES scalping_opportunities(id) ON DELETE SET NULL,
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('buy', 'sell')),
  entry_price DECIMAL(20,8) NOT NULL,
  quantity DECIMAL(20,8) NOT NULL,
  total_usdt DECIMAL(20,2) NOT NULL,
  -- Exit tracking
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  exit_price DECIMAL(20,8),
  exit_reason VARCHAR(50),                         -- take_profit, stop_loss, timeout, manual
  pnl_usdt DECIMAL(20,4),
  pnl_pct DECIMAL(8,4),
  -- Position management
  take_profit_price DECIMAL(20,8),
  stop_loss_price DECIMAL(20,8),
  highest_price DECIMAL(20,8),                     -- For tracking potential profit
  lowest_price DECIMAL(20,8),
  expires_at TIMESTAMPTZ,                          -- Max hold time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_user ON paper_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol ON paper_trades(symbol);

-- Learning model - tracks pattern success rates
CREATE TABLE IF NOT EXISTS scalping_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern_key VARCHAR(100) NOT NULL,               -- e.g., "BTCUSDT_rsi_oversold_high_volume"
  -- Pattern characteristics
  symbol VARCHAR(20) NOT NULL,
  conditions JSONB NOT NULL,                       -- {rsi_range, volume_range, drop_range, etc.}
  -- Statistics
  total_occurrences INTEGER DEFAULT 0,
  successful_trades INTEGER DEFAULT 0,
  failed_trades INTEGER DEFAULT 0,
  timeout_trades INTEGER DEFAULT 0,
  avg_profit_pct DECIMAL(8,4) DEFAULT 0,
  avg_loss_pct DECIMAL(8,4) DEFAULT 0,
  win_rate DECIMAL(5,4) DEFAULT 0,
  -- Derived confidence adjustment
  confidence_modifier DECIMAL(5,4) DEFAULT 0,      -- -1 to +1, applied to base confidence
  -- Tracking
  last_occurrence_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_scalping_patterns_user ON scalping_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_scalping_patterns_symbol ON scalping_patterns(symbol);

-- Scalping performance summary (daily aggregates)
CREATE TABLE IF NOT EXISTS scalping_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  mode VARCHAR(20) NOT NULL,                       -- paper or live
  -- Trade counts
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  timeout_trades INTEGER DEFAULT 0,
  -- PnL
  total_pnl_usdt DECIMAL(20,4) DEFAULT 0,
  avg_trade_pnl_usdt DECIMAL(20,4) DEFAULT 0,
  best_trade_pnl_usdt DECIMAL(20,4) DEFAULT 0,
  worst_trade_pnl_usdt DECIMAL(20,4) DEFAULT 0,
  -- Timing
  avg_hold_seconds INTEGER DEFAULT 0,
  -- Opportunities
  opportunities_detected INTEGER DEFAULT 0,
  opportunities_traded INTEGER DEFAULT 0,
  opportunities_skipped INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, mode)
);

CREATE INDEX IF NOT EXISTS idx_scalping_stats_user ON scalping_daily_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_scalping_stats_date ON scalping_daily_stats(date);

-- Price history cache for pattern analysis (short-term)
CREATE TABLE IF NOT EXISTS price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  price DECIMAL(20,8) NOT NULL,
  rsi_14 DECIMAL(5,2),
  volume_1m DECIMAL(30,8),
  avg_volume_1h DECIMAL(30,8),
  high_24h DECIMAL(20,8),
  low_24h DECIMAL(20,8),
  change_1h_pct DECIMAL(8,4),
  change_24h_pct DECIMAL(8,4),
  snapshot_time TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol ON price_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_time ON price_snapshots(snapshot_time);

-- Auto-cleanup old price snapshots (keep 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_price_snapshots()
RETURNS void AS $$
BEGIN
  DELETE FROM price_snapshots WHERE snapshot_time < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS scalping_settings_updated_at ON scalping_settings;
CREATE TRIGGER scalping_settings_updated_at
  BEFORE UPDATE ON scalping_settings
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();

DROP TRIGGER IF EXISTS scalping_patterns_updated_at ON scalping_patterns;
CREATE TRIGGER scalping_patterns_updated_at
  BEFORE UPDATE ON scalping_patterns
  FOR EACH ROW EXECUTE FUNCTION update_trading_updated_at();
