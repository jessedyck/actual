BEGIN TRANSACTION;

-- [fork:mc D-002] Fork-only multi-currency schema. See fork/DEVIATIONS.md.
-- Every name carries an `mc_` prefix so a future upstream migration that adds
-- its own currency columns can never collide with these.

-- ISO 4217 code of the account's currency. NULL means the budget currency.
ALTER TABLE accounts ADD COLUMN mc_currency TEXT DEFAULT NULL;

-- The amount in the account's own currency, in that currency's minor units.
-- NULL when the account uses the budget currency. `amount` keeps meaning the
-- budget-currency value, so budgets, balances and reports are unchanged.
ALTER TABLE transactions ADD COLUMN mc_amount INTEGER DEFAULT NULL;

-- Synced exchange-rate cache. Row ids are deterministic
-- (`YYYYMMDD:BASE:QUOTE`) so two devices storing the same rate update one row.
-- 1 unit of `base` = `rate` units of `quote`.
CREATE TABLE IF NOT EXISTS mc_exchange_rates
  (id TEXT PRIMARY KEY,
   date INTEGER,
   base TEXT,
   quote TEXT,
   rate REAL,
   source TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX IF NOT EXISTS mc_exchange_rates_pair_date
  ON mc_exchange_rates (base, quote, date);

COMMIT;
