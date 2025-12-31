-- Trading Rules for Visual Builder
-- Allows users to create automated trading rules with conditions and actions

CREATE TABLE IF NOT EXISTS trading_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  condition_logic VARCHAR(3) NOT NULL DEFAULT 'AND' CHECK (condition_logic IN ('AND', 'OR')),

  -- Rule constraints
  max_executions INTEGER DEFAULT NULL,
  cooldown_minutes INTEGER DEFAULT NULL,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,

  -- Metadata
  created_by VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rule conditions (multiple per rule)
CREATE TABLE IF NOT EXISTS trading_rule_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES trading_rules(id) ON DELETE CASCADE,
  condition_type VARCHAR(20) NOT NULL CHECK (condition_type IN ('price', 'indicator', 'time', 'change')),
  symbol VARCHAR(20),
  indicator VARCHAR(50),
  timeframe VARCHAR(10),
  operator VARCHAR(20) NOT NULL,
  value DECIMAL(20, 8) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rule actions (multiple per rule)
CREATE TABLE IF NOT EXISTS trading_rule_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES trading_rules(id) ON DELETE CASCADE,
  action_type VARCHAR(10) NOT NULL CHECK (action_type IN ('buy', 'sell', 'alert')),
  symbol VARCHAR(20),
  amount_type VARCHAR(10) NOT NULL DEFAULT 'quote' CHECK (amount_type IN ('quote', 'base', 'percent')),
  amount DECIMAL(20, 8) NOT NULL,
  order_type VARCHAR(10) NOT NULL DEFAULT 'market' CHECK (order_type IN ('market', 'limit')),
  limit_price DECIMAL(20, 8),
  stop_loss DECIMAL(5, 2),
  take_profit DECIMAL(5, 2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_trading_rules_user_id ON trading_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_rules_enabled ON trading_rules(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_trading_rule_conditions_rule_id ON trading_rule_conditions(rule_id);
CREATE INDEX IF NOT EXISTS idx_trading_rule_actions_rule_id ON trading_rule_actions(rule_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_trading_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_trading_rules_updated_at ON trading_rules;
CREATE TRIGGER trigger_trading_rules_updated_at
  BEFORE UPDATE ON trading_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_trading_rules_updated_at();
