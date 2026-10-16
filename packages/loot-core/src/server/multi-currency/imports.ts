// [fork:mc D-008] Imports into a foreign-currency account (file imports,
// bank sync and the API's `importTransactions`) carry amounts in the
// account's currency, in hundredths like every amount the API takes. They
// become `mc_amount`, and `amount` is converted before rules and duplicate
// matching run, so both see the budget value the transaction will have.
import {
  hundredthsToMinorUnits,
  minorUnitsToHundredths,
} from '#shared/multi-currency';
import { integerToAmount } from '#shared/util';
import type { TransactionEntity } from '#types/models';

import { createMonthRateLookup } from './month-rates';
import { getMultiCurrencyContext } from './rates';
import { loadForeignAccounts } from './transactions';

type ImportedAmounts = Pick<Partial<TransactionEntity>, 'amount' | 'mc_amount'>;

type NormalizedImport = {
  trans: ImportedAmounts & { date: string };
  subtransactions?: ImportedAmounts[] | null;
};

/** The account's currency when imports into it are converted, else null. */
export async function getImportCurrency(
  accountId: string,
): Promise<string | null> {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    return null;
  }
  return (await loadForeignAccounts(budgetCurrency)).get(accountId) ?? null;
}

/**
 * Moves each imported amount to `mc_amount` and converts `amount` at the
 * rate of the transaction's month (0 while no rate is known, like any
 * pending conversion). A transaction that already has `mc_amount` keeps both amounts
 * as given. Split children only get `mc_amount`: the server derives their
 * budget amounts when they are saved and rounds them to match the parent
 * (D-006).
 */
export async function readImportedAmounts(
  normalized: NormalizedImport[],
  currency: string,
): Promise<void> {
  const { budgetCurrency } = await getMultiCurrencyContext();
  const pending = normalized.filter(
    ({ trans }) => trans.mc_amount === undefined,
  );
  // [fork:mc D-017] At the rate of each transaction's month
  const lookup = createMonthRateLookup();

  for (const { trans, subtransactions } of pending) {
    const mcAmount = hundredthsToMinorUnits(trans.amount ?? 0, currency);
    trans.mc_amount = mcAmount;
    trans.amount =
      (await lookup.convert(mcAmount, trans.date, currency, budgetCurrency)) ??
      0;

    for (const sub of subtransactions ?? []) {
      if (sub.mc_amount === undefined) {
        sub.mc_amount = hundredthsToMinorUnits(sub.amount ?? 0, currency);
        sub.amount = 0;
      }
    }
  }
  await lookup.flush();
}

/**
 * The amount condition for matching an imported transaction with existing
 * ones. In a foreign-currency account it compares account amounts, falling
 * back to the budget amount for rows whose conversion is still pending;
 * otherwise it is upstream's condition.
 */
export function getImportAmountMatch(
  trans: ImportedAmounts,
  currency: string | null,
): { sql: string; params: number[] } {
  if (!currency || trans.mc_amount == null) {
    return { sql: 'amount = ?', params: [trans.amount || 0] };
  }
  if (!trans.amount) {
    return { sql: 'mc_amount = ?', params: [trans.mc_amount] };
  }
  return {
    sql: '(mc_amount = ? OR (mc_amount IS NULL AND amount = ?))',
    params: [trans.mc_amount, trans.amount],
  };
}

/**
 * A matched transaction's amount as the import preview shows it: a decimal
 * in the account's currency, like the amounts read from the file.
 */
export function getImportPreviewAmount(
  existing: ImportedAmounts,
  imported: ImportedAmounts,
  currency: string,
): number {
  const mcAmount = existing.mc_amount ?? imported.mc_amount;
  return mcAmount == null
    ? integerToAmount(existing.amount ?? 0)
    : integerToAmount(minorUnitsToHundredths(mcAmount, currency));
}
