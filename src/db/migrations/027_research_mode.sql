-- Research Mode: Scalping signal detection and auto-execution
-- Migration 027

-- Research settings per user
CREATE TABLE IF NOT EXISTS research_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  execution_mode VARCHAR(20) DEFAULT 'manual' CHECK (execution_mode IN ('auto', 'confirm', 'manual')),
  paper_live_mode VARCHAR(20) DEFAULT 'paper' CHECK (paper_live_mode IN ('paper', 'live')),
  enable_auto_discovery BOOLEAN DEFAULT true,
  auto_discovery_limit INTEGER DEFAULT 20,
  custom_symbols TEXT[] DEFAULT ARRAY[]::TEXT[],
  min_confidence DECIMAL(5,4) DEFAULT 0.6,
  scan_interval_seconds INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Research signals log
CREATE TABLE IF NOT EXISTS research_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  price DECIMAL(20,8) NOT NULL,
  rsi_1m DECIMAL(5,2),
  rsi_5m DECIMAL(5,2),
  price_drop_pct DECIMAL(8,4),
  volume_ratio DECIMAL(8,4),
  confidence DECIMAL(5,4) NOT NULL,
  reasons JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'skipped', 'expired', 'failed')),
  execution_mode VARCHAR(20) NOT NULL,
  paper_live_mode VARCHAR(20) NOT NULL DEFAULT 'paper',
  trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
  paper_trade_id UUID REFERENCES paper_trades(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_research_signals_user ON research_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_research_signals_status ON research_signals(status);
CREATE INDEX IF NOT EXISTS idx_research_signals_created ON research_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_signals_symbol ON research_signals(symbol);

-- Add updated_at trigger for research_settings
CREATE OR REPLACE FUNCTION update_research_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS research_settings_updated_at ON research_settings;
CREATE TRIGGER research_settings_updated_at
  BEFORE UPDATE ON research_settings
  FOR EACH ROW EXECUTE FUNCTION update_research_settings_updated_at();

-- Insert default settings for existing users with trading keys
INSERT INTO research_settings (user_id)
SELECT DISTINCT user_id FROM user_trading_keys
ON CONFLICT (user_id) DO NOTHING;
