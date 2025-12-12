-- Enhanced Indicators for Research Mode
-- Adds MACD, Bollinger Bands, EMA Crossovers, and Volume Analysis

-- Indicator settings table
CREATE TABLE IF NOT EXISTS indicator_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preset VARCHAR(20) DEFAULT 'balanced',

  -- Individual indicator toggles
  enable_rsi BOOLEAN DEFAULT true,
  enable_macd BOOLEAN DEFAULT true,
  enable_bollinger BOOLEAN DEFAULT true,
  enable_ema BOOLEAN DEFAULT true,
  enable_volume BOOLEAN DEFAULT true,
  enable_price_action BOOLEAN DEFAULT true,

  -- Custom weights (used when preset = 'custom')
  weight_rsi DECIMAL(4,2) DEFAULT 0.25,
  weight_macd DECIMAL(4,2) DEFAULT 0.20,
  weight_bollinger DECIMAL(4,2) DEFAULT 0.20,
  weight_ema DECIMAL(4,2) DEFAULT 0.15,
  weight_volume DECIMAL(4,2) DEFAULT 0.10,
  weight_price_action DECIMAL(4,2) DEFAULT 0.10,

  -- Indicator parameters
  macd_fast INTEGER DEFAULT 12,
  macd_slow INTEGER DEFAULT 26,
  macd_signal INTEGER DEFAULT 9,
  bollinger_period INTEGER DEFAULT 20,
  bollinger_stddev DECIMAL(3,1) DEFAULT 2.0,
  ema_short INTEGER DEFAULT 9,
  ema_medium INTEGER DEFAULT 21,
  ema_long INTEGER DEFAULT 50,
  volume_avg_period INTEGER DEFAULT 20,
  volume_spike_threshold DECIMAL(3,1) DEFAULT 2.0,

  -- Minimum confidence threshold
  min_confidence DECIMAL(4,2) DEFAULT 0.60,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indicator data columns to research_signals table
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS macd_value DECIMAL(10,4);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS macd_signal_value DECIMAL(10,4);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS macd_histogram DECIMAL(10,4);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS macd_crossover VARCHAR(20);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS bollinger_percent_b DECIMAL(5,4);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS bollinger_squeeze BOOLEAN DEFAULT false;
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS ema_trend VARCHAR(10);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS ema_crossover VARCHAR(20);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS volume_spike BOOLEAN DEFAULT false;
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS volume_ratio_value DECIMAL(5,2);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS rsi_15m DECIMAL(5,2);
ALTER TABLE research_signals ADD COLUMN IF NOT EXISTS indicator_breakdown JSONB;

-- Index for preset queries
CREATE INDEX IF NOT EXISTS idx_indicator_settings_preset ON indicator_settings(preset);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_indicator_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS indicator_settings_updated_at ON indicator_settings;
CREATE TRIGGER indicator_settings_updated_at
  BEFORE UPDATE ON indicator_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_indicator_settings_updated_at();

-- Insert default settings for existing users with research_settings
INSERT INTO indicator_settings (user_id)
SELECT user_id FROM research_settings
ON CONFLICT (user_id) DO NOTHING;
