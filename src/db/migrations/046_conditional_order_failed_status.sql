-- Add 'failed' status to conditional_orders for orders that fail to execute
-- This prevents infinite retry loops when orders fail due to insufficient balance, etc.

-- First, drop the existing constraint
ALTER TABLE conditional_orders DROP CONSTRAINT IF EXISTS conditional_orders_status_check;

-- Add the new constraint with 'failed' status
ALTER TABLE conditional_orders ADD CONSTRAINT conditional_orders_status_check
  CHECK (status IN ('active', 'triggered', 'cancelled', 'expired', 'failed'));

-- Add notes column for storing failure reason
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS notes TEXT;
