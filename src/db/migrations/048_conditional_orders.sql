-- Migration 048: Conditional Orders System
-- Description: Support for complex conditional orders with compound triggers
-- Example: "buy ETH if price <= 2700 AND RSI < 30, then trail SL from 2800"

-- Conditional orders table
CREATE TABLE IF NOT EXISTS conditional_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Symbol and market
  symbol VARCHAR(20) NOT NULL,
  market_type VARCHAR(10) DEFAULT 'spot' CHECK (market_type IN ('spot', 'alpha')),

  -- Trigger conditions (JSONB for flexibility)
  -- Example: {"logic": "AND", "conditions": [{"type": "price", "operator": "<=", "value": 2700}, {"type": "rsi", "operator": "<", "value": 30, "period": 14}]}
  trigger_conditions JSONB NOT NULL,

  -- Action to execute when triggered
  -- Example: {"side": "buy", "type": "market", "quantity": null, "quote_amount": 15}
  action JSONB NOT NULL,

  -- Follow-up actions after order fills
  -- Example: {"trailing_stop": {"activation_price": 2800, "initial_sl": 2770, "callback_pct": 2}, "take_profit": 3000}
  follow_up JSONB,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'monitoring', 'triggered', 'executing', 'executed', 'partially_filled', 'cancelled', 'failed', 'expired')),

  -- Execution details
  triggered_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  trigger_price DECIMAL(20, 8),  -- Price when condition was met
  trigger_details JSONB,         -- Full state when triggered (RSI value, etc.)

  -- Result tracking
  result_trade_id UUID REFERENCES trades(id),
  result_order_id VARCHAR(100),  -- Binance order ID
  error_message TEXT,
  retry_count INT DEFAULT 0,

  -- Expiration
  expires_at TIMESTAMPTZ,

  -- Notes and metadata
  notes TEXT,
  source VARCHAR(50) DEFAULT 'manual',  -- 'manual', 'chat', 'telegram', 'api'
  original_text TEXT,  -- Original natural language command

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_conditional_orders_user_status
  ON conditional_orders(user_id, status);

CREATE INDEX IF NOT EXISTS idx_conditional_orders_pending
  ON conditional_orders(status, symbol)
  WHERE status IN ('pending', 'monitoring');

CREATE INDEX IF NOT EXISTS idx_conditional_orders_expires
  ON conditional_orders(expires_at)
  WHERE status IN ('pending', 'monitoring') AND expires_at IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_conditional_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conditional_orders_updated_at ON conditional_orders;
CREATE TRIGGER conditional_orders_updated_at
  BEFORE UPDATE ON conditional_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_conditional_orders_updated_at();

-- Conditional order history/audit log
CREATE TABLE IF NOT EXISTS conditional_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES conditional_orders(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,  -- 'created', 'condition_checked', 'triggered', 'executed', 'cancelled', 'failed', 'expired'
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conditional_order_events_order
  ON conditional_order_events(order_id, created_at DESC);

-- Comments
COMMENT ON TABLE conditional_orders IS 'Complex conditional orders with compound triggers (price + indicators)';
COMMENT ON COLUMN conditional_orders.trigger_conditions IS 'JSON: {"logic": "AND|OR", "conditions": [{"type": "price|rsi|macd|volume", "operator": "<|<=|>|>=|crosses_above|crosses_below", "value": number, ...}]}';
COMMENT ON COLUMN conditional_orders.action IS 'JSON: {"side": "buy|sell", "type": "market|limit", "quantity": number|null, "quote_amount": number|null, "price": number|null}';
COMMENT ON COLUMN conditional_orders.follow_up IS 'JSON: {"trailing_stop": {...}, "stop_loss": number, "take_profit": number}';
