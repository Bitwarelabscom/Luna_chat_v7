-- Migration 101: Add currency support to finance entries
-- Rename amount_usd -> amount, add currency column

ALTER TABLE ceo_finance_entries ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE ceo_finance_entries RENAME COLUMN amount_usd TO amount;
ALTER TABLE ceo_finance_entries DROP CONSTRAINT IF EXISTS ceo_finance_entries_amount_usd_check;
ALTER TABLE ceo_finance_entries ADD CONSTRAINT ceo_finance_entries_amount_check CHECK (amount >= 0);
CREATE INDEX IF NOT EXISTS idx_ceo_finance_user_currency ON ceo_finance_entries(user_id, currency, occurred_on DESC);
