-- Allow globally executed paper trades to persist with "filled" status.
-- Existing scalping flow continues using open/closed/expired.

ALTER TABLE paper_trades
DROP CONSTRAINT IF EXISTS paper_trades_status_check;

ALTER TABLE paper_trades
ADD CONSTRAINT paper_trades_status_check
CHECK (status IN ('open', 'closed', 'expired', 'filled'));
