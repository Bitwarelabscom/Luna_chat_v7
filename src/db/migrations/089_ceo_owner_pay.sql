-- Add 'owner_pay' entry_type to ceo_finance_entries for saldo system
ALTER TABLE ceo_finance_entries DROP CONSTRAINT IF EXISTS ceo_finance_entries_entry_type_check;
ALTER TABLE ceo_finance_entries ADD CONSTRAINT ceo_finance_entries_entry_type_check
  CHECK (entry_type IN ('expense', 'income', 'owner_pay'));
