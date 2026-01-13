-- Dual-mode trading settings
-- 70% conservative (multi-indicator confluence) + 30% aggressive (triple-signal)
-- Trailing stop only - no fixed take profit

-- Add dual-mode columns to auto_trading_settings
ALTER TABLE auto_trading_settings
  ADD COLUMN IF NOT EXISTS dual_mode_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS conservative_capital_pct DECIMAL(5,2) DEFAULT 70,
  ADD COLUMN IF NOT EXISTS aggressive_capital_pct DECIMAL(5,2) DEFAULT 30,
  ADD COLUMN IF NOT EXISTS trailing_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS trail_activation_pct DECIMAL(5,2) DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS trail_distance_pct DECIMAL(5,2) DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS conservative_symbols TEXT[] DEFAULT ARRAY['BTC_USD','ETH_USD','SOL_USD','XRP_USD','ADA_USD','AVAX_USD','DOT_USD','LINK_USD','ATOM_USD','UNI_USD'],
  ADD COLUMN IF NOT EXISTS aggressive_symbols TEXT[] DEFAULT ARRAY['DOGE_USD','SHIB_USD','BONK_USD','PONKE_USD','PEPE_USD','GALA_USD','APE_USD'],
  ADD COLUMN IF NOT EXISTS conservative_min_confidence DECIMAL(3,2) DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS aggressive_min_confidence DECIMAL(3,2) DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS conservative_cooldown_minutes INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS aggressive_cooldown_minutes INTEGER DEFAULT 5;

-- Add tracking columns to trading_positions for trailing stop
ALTER TABLE trading_positions
  ADD COLUMN IF NOT EXISTS highest_price DECIMAL(20,8),
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'conservative';

-- Add tier column to trades table for dual-mode tracking
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20);

-- Create indexes for tier-based queries
CREATE INDEX IF NOT EXISTS idx_trading_positions_tier ON trading_positions(tier);
CREATE INDEX IF NOT EXISTS idx_trades_tier ON trades(tier);
