-- Add partial take profit support
-- TP1: First take profit level (sells part of position)
-- TP2: Second take profit level (sells remaining position)

ALTER TABLE trades
ADD COLUMN IF NOT EXISTS tp1_price DECIMAL(24, 8),
ADD COLUMN IF NOT EXISTS tp2_price DECIMAL(24, 8),
ADD COLUMN IF NOT EXISTS tp1_pct INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS quantity_sold_tp1 DECIMAL(24, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMP;

-- Also add to paper_trades for paper trading support
ALTER TABLE paper_trades
ADD COLUMN IF NOT EXISTS tp1_price DECIMAL(24, 8),
ADD COLUMN IF NOT EXISTS tp2_price DECIMAL(24, 8),
ADD COLUMN IF NOT EXISTS tp1_pct INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS quantity_sold_tp1 DECIMAL(24, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMP;

-- Add comments
COMMENT ON COLUMN trades.tp1_price IS 'First take profit price (partial exit)';
COMMENT ON COLUMN trades.tp2_price IS 'Second take profit price (full exit)';
COMMENT ON COLUMN trades.tp1_pct IS 'Percentage of position to sell at TP1 (default 50%)';
COMMENT ON COLUMN trades.quantity_sold_tp1 IS 'Quantity already sold at TP1';
COMMENT ON COLUMN trades.tp1_hit_at IS 'Timestamp when TP1 was hit';
