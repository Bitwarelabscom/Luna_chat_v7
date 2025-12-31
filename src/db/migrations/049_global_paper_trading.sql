-- Global Paper Trading Mode
-- Adds paper/live mode switch to trading settings affecting all trading features

-- Add paper mode columns to trading_settings
ALTER TABLE trading_settings
ADD COLUMN IF NOT EXISTS paper_mode BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS paper_balance_usdc DECIMAL(20,2) DEFAULT 10000.00;

-- Paper portfolio to track simulated asset balances
CREATE TABLE IF NOT EXISTS paper_portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset VARCHAR(20) NOT NULL,
  balance DECIMAL(20,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_paper_portfolio_user ON paper_portfolio(user_id);

-- Extend existing paper_trades for global use (not just scalping)
ALTER TABLE paper_trades
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'scalping',
ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES trading_bots(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS conditional_order_id UUID;

-- Allow paper_trades without opportunity_id (for non-scalping paper trades)
ALTER TABLE paper_trades ALTER COLUMN opportunity_id DROP NOT NULL;

-- Add indexes for global paper trades
CREATE INDEX IF NOT EXISTS idx_paper_trades_source ON paper_trades(source);
CREATE INDEX IF NOT EXISTS idx_paper_trades_bot ON paper_trades(bot_id) WHERE bot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paper_trades_user_status ON paper_trades(user_id, status);

-- Function to initialize paper portfolio with starting USDC balance
CREATE OR REPLACE FUNCTION initialize_paper_portfolio(p_user_id UUID, p_starting_balance DECIMAL)
RETURNS VOID AS $$
BEGIN
  -- Delete existing paper portfolio for user
  DELETE FROM paper_portfolio WHERE user_id = p_user_id;

  -- Insert USDC starting balance
  INSERT INTO paper_portfolio (user_id, asset, balance)
  VALUES (p_user_id, 'USDC', p_starting_balance);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-initialize paper portfolio when paper_mode is enabled
CREATE OR REPLACE FUNCTION on_paper_mode_change()
RETURNS TRIGGER AS $$
BEGIN
  -- If paper_mode changed from false to true, initialize portfolio
  IF NEW.paper_mode = true AND (OLD.paper_mode IS NULL OR OLD.paper_mode = false) THEN
    PERFORM initialize_paper_portfolio(NEW.user_id, NEW.paper_balance_usdc);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_paper_mode_change ON trading_settings;
CREATE TRIGGER trigger_paper_mode_change
AFTER UPDATE OF paper_mode ON trading_settings
FOR EACH ROW
EXECUTE FUNCTION on_paper_mode_change();
