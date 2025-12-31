-- Advanced Signal Features Settings
-- Adds support for: MTF Confluence, VWAP Entry, ATR Stops, BTC Correlation Filter, Liquidity Sweep Detection

-- Feature preset and toggles on indicator_settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS feature_preset VARCHAR(20) DEFAULT 'basic'
  CHECK (feature_preset IN ('basic', 'intermediate', 'pro'));

-- MTF Confluence Settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS enable_mtf_confluence BOOLEAN DEFAULT false;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS mtf_higher_timeframe VARCHAR(10) DEFAULT '1h';

-- VWAP Settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS enable_vwap_entry BOOLEAN DEFAULT false;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS vwap_anchor_type VARCHAR(20) DEFAULT '24h_low';

-- ATR Stop Loss Settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS enable_atr_stops BOOLEAN DEFAULT false;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS atr_period INTEGER DEFAULT 14;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS atr_sl_multiplier DECIMAL(3,1) DEFAULT 2.0;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS atr_tp_multiplier DECIMAL(3,1) DEFAULT 3.0;

-- BTC Correlation Settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS enable_btc_filter BOOLEAN DEFAULT false;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS btc_dump_threshold DECIMAL(4,2) DEFAULT 1.5;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS btc_lookback_minutes INTEGER DEFAULT 30;

-- Liquidity Sweep Settings
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS enable_liquidity_sweep BOOLEAN DEFAULT false;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS sweep_wick_ratio DECIMAL(3,1) DEFAULT 1.5;
ALTER TABLE indicator_settings
ADD COLUMN IF NOT EXISTS sweep_volume_multiplier DECIMAL(3,1) DEFAULT 2.0;

-- Store advanced analysis data in research_signals
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS mtf_trend_1h VARCHAR(10);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS mtf_confluence_score DECIMAL(4,3);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS vwap_value DECIMAL(20,8);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS vwap_reclaim BOOLEAN DEFAULT false;
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS atr_value DECIMAL(20,8);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS atr_stop_loss DECIMAL(20,8);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS atr_take_profit DECIMAL(20,8);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS btc_change_30m DECIMAL(6,3);
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS btc_filter_active BOOLEAN DEFAULT false;
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS liquidity_sweep BOOLEAN DEFAULT false;
ALTER TABLE research_signals
ADD COLUMN IF NOT EXISTS sweep_confidence DECIMAL(4,3);

-- Add comments for documentation
COMMENT ON COLUMN indicator_settings.feature_preset IS 'Trading logic preset: basic (current), intermediate (MTF+VWAP+ATR), pro (all 5 features)';
COMMENT ON COLUMN indicator_settings.enable_mtf_confluence IS 'Multi-Timeframe Confluence: Only signal if 1h trend confirms 5m entry';
COMMENT ON COLUMN indicator_settings.enable_vwap_entry IS 'VWAP Entry: Only signal if price is reclaiming VWAP anchored to 24h low';
COMMENT ON COLUMN indicator_settings.enable_atr_stops IS 'ATR-Based Stops: Use ATR for dynamic SL/TP instead of static %';
COMMENT ON COLUMN indicator_settings.enable_btc_filter IS 'BTC Correlation Filter: Pause altcoin longs if BTC dumps';
COMMENT ON COLUMN indicator_settings.enable_liquidity_sweep IS 'Liquidity Sweep Detection: Identify stop-hunt patterns';
