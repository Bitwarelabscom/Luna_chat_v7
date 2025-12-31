-- Migration 048: Extend Conditional Orders for Compound Triggers
-- Description: Add support for compound triggers (price + indicators) and follow-up actions

-- Add new columns for compound trigger conditions
ALTER TABLE conditional_orders
  ADD COLUMN IF NOT EXISTS trigger_conditions JSONB,
  ADD COLUMN IF NOT EXISTS follow_up JSONB,
  ADD COLUMN IF NOT EXISTS market_type VARCHAR(10) DEFAULT 'spot',
  ADD COLUMN IF NOT EXISTS trigger_details JSONB,
  ADD COLUMN IF NOT EXISTS result_trade_id UUID,
  ADD COLUMN IF NOT EXISTS result_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS original_text TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Update status constraint to include new statuses
ALTER TABLE conditional_orders DROP CONSTRAINT IF EXISTS conditional_orders_status_check;
ALTER TABLE conditional_orders ADD CONSTRAINT conditional_orders_status_check
  CHECK (status IN ('active', 'pending', 'monitoring', 'triggered', 'executing', 'executed', 'partially_filled', 'cancelled', 'failed', 'expired'));

-- Add market type constraint
ALTER TABLE conditional_orders DROP CONSTRAINT IF EXISTS conditional_orders_market_type_check;
ALTER TABLE conditional_orders ADD CONSTRAINT conditional_orders_market_type_check
  CHECK (market_type IN ('spot', 'alpha'));

-- Add foreign key for result_trade_id if trades table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'conditional_orders_result_trade_id_fkey'
  ) THEN
    ALTER TABLE conditional_orders
      ADD CONSTRAINT conditional_orders_result_trade_id_fkey
      FOREIGN KEY (result_trade_id) REFERENCES trades(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create or update trigger for updated_at
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

-- Create conditional_order_events if not exists
CREATE TABLE IF NOT EXISTS conditional_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES conditional_orders(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conditional_order_events_order
  ON conditional_order_events(order_id, created_at DESC);

-- Comments
COMMENT ON COLUMN conditional_orders.trigger_conditions IS 'Compound triggers: {"logic": "AND|OR", "conditions": [{"type": "price|rsi|macd", "operator": "<|<=|>|>=", "value": number}]}';
COMMENT ON COLUMN conditional_orders.follow_up IS 'Post-fill actions: {"trailing_stop": {"activation_price": X, "callback_pct": Y}, "stop_loss": X, "take_profit": X}';
COMMENT ON COLUMN conditional_orders.original_text IS 'Original natural language command from user';
