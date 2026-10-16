BEGIN TRANSACTION;

-- [fork:mc D-017] Fork-only: a currency on each budget. See
-- fork/DEVIATIONS.md. Names carry the fork's `mc_` prefix.

-- ISO 4217 code of a category's budget in a month. NULL means the default
-- currency (as it applied in that month).
ALTER TABLE zero_budgets ADD COLUMN mc_currency TEXT DEFAULT NULL;
ALTER TABLE reflect_budgets ADD COLUMN mc_currency TEXT DEFAULT NULL;

-- A categorized transaction's value in its budget's currency, in that
-- currency's minor units. NULL when that is the default currency, where
-- `amount` already is the value. The budget sums this value per category.
ALTER TABLE transactions ADD COLUMN mc_budget_amount INTEGER DEFAULT NULL;

COMMIT;
