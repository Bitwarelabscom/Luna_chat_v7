-- Migration: Multi-Strategy Auto Trading System
-- Adds strategy selection, BTC influence controls, exclusion settings, and performance tracking

-- Extend auto_trading_settings with strategy options
ALTER TABLE auto_trading_settings
ADD COLUMN IF NOT EXISTS strategy VARCHAR(30) DEFAULT 'rsi_oversold',
ADD COLUMN IF NOT EXISTS strategy_mode VARCHAR(10) DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS excluded_symbols TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclude_top_10 BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS btc_trend_filter BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS btc_momentum_boost BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS btc_correlation_skip BOOLEAN DEFAULT true;

-- Strategy performance tracking (rolling 20 trades per strategy)
CREATE TABLE IF NOT EXISTS auto_strategy_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  strategy VARCHAR(30) NOT NULL,
  trade_result VARCHAR(10) NOT NULL, -- 'win', 'loss', 'breakeven'
  pnl_pct DECIMAL(10,4),
  symbol VARCHAR(20),
  regime VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_strategy_perf_user_strategy
ON auto_strategy_performance(user_id, strategy, created_at DESC);

-- Market regime cache (updated each scan cycle)
CREATE TABLE IF NOT EXISTS market_regime (
  symbol VARCHAR(20) PRIMARY KEY DEFAULT 'BTCUSDT',
  regime VARCHAR(20) NOT NULL, -- 'trending', 'ranging', 'mixed'
  adx DECIMAL(10,4),
  btc_trend VARCHAR(10), -- 'bullish', 'bearish', 'neutral'
  btc_momentum DECIMAL(10,4),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BTC correlation cache (updated periodically)
CREATE TABLE IF NOT EXISTS btc_correlation_cache (
  symbol VARCHAR(20) PRIMARY KEY,
  correlation_30d DECIMAL(6,4),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto mode selection history (for analysis)
CREATE TABLE IF NOT EXISTS auto_mode_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  selected_strategy VARCHAR(30),
  regime VARCHAR(20),
  total_score DECIMAL(10,4),
  regime_score DECIMAL(10,4),
  winrate_score DECIMAL(10,4),
  alternatives JSONB, -- {strategy: score, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_mode_selections_user
ON auto_mode_selections(user_id, created_at DESC);

-- Extend signals table with strategy info
ALTER TABLE auto_trading_signals
ADD COLUMN IF NOT EXISTS strategy VARCHAR(30) DEFAULT 'rsi_oversold',
ADD COLUMN IF NOT EXISTS regime VARCHAR(20);

-- Trigger to maintain rolling 20 trades per user/strategy
CREATE OR REPLACE FUNCTION maintain_strategy_perf_window() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM auto_strategy_performance
  WHERE id IN (
    SELECT id FROM auto_strategy_performance
    WHERE user_id = NEW.user_id AND strategy = NEW.strategy
    ORDER BY created_at DESC
    OFFSET 20
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategy_perf ON auto_strategy_performance;
CREATE TRIGGER trg_strategy_perf
AFTER INSERT ON auto_strategy_performance
FOR EACH ROW EXECUTE FUNCTION maintain_strategy_perf_window();

-- Insert default market regime for BTC
INSERT INTO market_regime (symbol, regime, adx, btc_trend, btc_momentum)
VALUES ('BTCUSDT', 'mixed', 22.0, 'neutral', 0.0)
ON CONFLICT (symbol) DO NOTHING;
