-- Trading Intelligence & Luna AI Strategy
-- Migration 114: All-time P/L baselines, intelligence scraping, LLM analysis

-- All-time P/L baseline
CREATE TABLE IF NOT EXISTS portfolio_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  baseline_value_usdt DECIMAL(20,2) NOT NULL,
  baseline_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Intelligence scrape log (audit trail for LLM)
CREATE TABLE IF NOT EXISTS trading_intelligence_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  title TEXT,
  summary TEXT,
  raw_data JSONB,
  sentiment_score DECIMAL(5,3),
  symbols TEXT[],
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trading_intel_scraped ON trading_intelligence_log(scraped_at);

-- LLM analysis decisions
CREATE TABLE IF NOT EXISTS trading_llm_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  trigger_reason VARCHAR(100) NOT NULL,
  intelligence_summary TEXT,
  llm_response TEXT,
  decisions JSONB,
  executed_trade_ids UUID[],
  model_used VARCHAR(100),
  tokens_used INTEGER,
  cost_usd DECIMAL(10,4),
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy context on trades
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_reason TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5,3);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS analysis_id UUID;

-- Luna AI settings columns on auto_trading_settings
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'moderate';
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS llm_analysis_interval_hours INTEGER DEFAULT 6;
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS early_trigger_btc_pct DECIMAL(5,2) DEFAULT 3.0;
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS early_trigger_coin_pct DECIMAL(5,2) DEFAULT 5.0;
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS early_trigger_volume_x DECIMAL(5,2) DEFAULT 3.0;
ALTER TABLE auto_trading_settings ADD COLUMN IF NOT EXISTS data_sources_enabled TEXT[] DEFAULT ARRAY['technicals','news','sentiment','fear_greed'];
