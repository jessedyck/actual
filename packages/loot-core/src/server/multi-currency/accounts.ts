// [fork:mc D-005] Account-level multi-currency operations.
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { getDecimalPlaces } from '#shared/currencies';
import { isCurrencyCode } from '#shared/multi-currency';
import { amountToInteger } from '#shared/util';

import { getBudgetValue, getBudgetValueUpdates } from './budget-currency';
import { createMonthRateLookup, loadBudgetCurrencies } from './month-rates';
import { getMultiCurrencyContext } from './rates';
import { loadForeignAccounts } from './transactions';

/**
 * The currency to store on an account: null when the feature is off, the
 * code is invalid, or it equals the budget currency.
 */
export async function normalizeAccountCurrency(
  currency: string | null | undefined,
): Promise<string | null> {
  if (!currency || !isCurrencyCode(currency)) {
    return null;
  }
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  return enabled && currency !== budgetCurrency ? currency : null;
}

/**
 * Amounts for a new account's starting balance. `balance` is a decimal in
 * the account's currency (as typed by the user).
 */
export async function getStartingBalanceAmounts({
  balance,
  currency,
  date,
}: {
  balance: number;
  currency: string | null;
  date: string;
}): Promise<{ amount: number; mc_amount?: number }> {
  if (!currency) {
    return { amount: amountToInteger(balance) };
  }
  const { budgetCurrency } = await getMultiCurrencyContext();
  const mcAmount = amountToInteger(balance, getDecimalPlaces(currency));
  // [fork:mc D-017] At the rate of the date's month
  const lookup = createMonthRateLookup();
  const amount =
    (await lookup.convert(mcAmount, date, currency, budgetCurrency)) ?? 0;
  await lookup.flush();
  return { amount, mc_amount: mcAmount };
}

// Notes written by the documented rule-template workaround, e.g.
// "52.43 AUD (FX rate: 0.65) • Lunch" or "-52.43 AUD (FX rate: 0.65)".
const WORKAROUND_NOTE =
  /^\s*(-?\d+(?:\.\d+)?)\s+([A-Z]{3})\s+\(FX rate:\s*[\d.]+\)/;

/**
 * The account-currency amount recorded by the docs workaround, in `currency`
 * minor units, or null when the note doesn't carry one for that currency.
 */
export function parseWorkaroundNote(
  notes: string | null | undefined,
  currency: string,
): number | null {
  const match = notes ? WORKAROUND_NOTE.exec(notes) : null;
  if (!match || match[2] !== currency) {
    return null;
  }
  return amountToInteger(parseFloat(match[1]), getDecimalPlaces(currency));
}

/** [fork:mc D-017] The currency of an amount written by the workaround. */
export function getWorkaroundNoteCurrency(
  notes: string | null | undefined,
): string | null {
  const match = notes ? WORKAROUND_NOTE.exec(notes) : null;
  return match ? match[2] : null;
}

type BackfillRow = {
  id: string;
  amount: number;
  mc_amount: number | null;
  date: number;
  notes: string | null;
  is_parent: 0 | 1;
  parent_id: string | null;
  category: string | null;
  mc_budget_amount: number | null;
};

const BACKFILL_FIELDS =
  'id, amount, mc_amount, date, notes, is_parent, parent_id, category, mc_budget_amount';

/**
 * Converting split parents and children one by one can leave the children a
 * minor unit or two off the parent. Moves the difference onto the largest
 * child so the split stays valid in the account's currency.
 */
export function balanceSplits(
  rows: Array<Pick<BackfillRow, 'id' | 'is_parent' | 'parent_id'>>,
  values: Map<string, number | null>,
): void {
  for (const parent of rows.filter(row => row.is_parent === 1)) {
    const parentValue = values.get(parent.id);
    const children = rows.filter(row => row.parent_id === parent.id);
    if (parentValue == null || children.length === 0) {
      continue;
    }
    if (children.some(child => values.get(child.id) == null)) {
      continue;
    }
    const total = children.reduce(
      (sum, child) => sum + (values.get(child.id) as number),
      0,
    );
    const difference = parentValue - total;
    if (difference === 0 || Math.abs(difference) > children.length) {
      continue;
    }
    const largest = children.reduce((a, b) =>
      Math.abs(values.get(b.id) as number) >
      Math.abs(values.get(a.id) as number)
        ? b
        : a,
    );
    values.set(largest.id, (values.get(largest.id) as number) + difference);
  }
}

/**
 * Sets an account's currency and fills in account-currency amounts for its
 * existing transactions: from workaround notes when present, otherwise by
 * converting the budget amount at the rate of each transaction's month.
 * Setting the budget currency (or null) clears them. [fork:mc D-017] Values
 * counted in budgets of another currency follow the new account amounts.
 */
export async function setAccountCurrency({
  id,
  currency,
}: {
  id: string;
  currency: string | null;
}): Promise<{ updated: number; missingRates: number }> {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    throw new Error('Multi-currency is not enabled');
  }
  if (currency && !isCurrencyCode(currency)) {
    throw new Error(`Invalid currency: ${JSON.stringify(currency)}`);
  }
  const code = currency && currency !== budgetCurrency ? currency : null;

  const rows = await db.all<BackfillRow>(
    `SELECT ${BACKFILL_FIELDS} FROM v_transactions_internal_alive
      WHERE account = ?`,
    [id],
  );

  const updates: Array<{
    id: string;
    mc_amount: number | null;
    mc_budget_amount?: number | null;
  }> = [];
  let missingRates = 0;
  const lookup = createMonthRateLookup();
  if (code) {
    const values = new Map<string, number | null>();
    for (const row of rows) {
      const fromNote = parseWorkaroundNote(row.notes, code);
      const mcAmount =
        fromNote ??
        (await lookup.convert(
          row.amount,
          db.fromDateRepr(row.date),
          budgetCurrency,
          code,
        ));
      if (mcAmount == null) {
        missingRates++;
      }
      values.set(row.id, mcAmount);
    }
    balanceSplits(rows, values);
    for (const row of rows) {
      updates.push({ id: row.id, mc_amount: values.get(row.id) ?? null });
    }
  } else {
    for (const row of rows.filter(row => row.mc_amount != null)) {
      updates.push({ id: row.id, mc_amount: null });
    }
  }

  // [fork:mc D-017] Values counted in budgets of another currency
  const context = await getMultiCurrencyContext();
  const budgets = await loadBudgetCurrencies();
  const accountRow = await db.first<Pick<db.DbAccount, 'offbudget'>>(
    'SELECT offbudget FROM accounts WHERE id = ?',
    [id],
  );
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const update of updates) {
    const row = byId.get(update.id) as BackfillRow;
    if (row.is_parent === 1) {
      continue;
    }
    const value = await getBudgetValue({
      context,
      budgets,
      accountCurrency: code ?? budgetCurrency,
      isOffBudget: accountRow?.offbudget === 1,
      category: row.category,
      date: db.fromDateRepr(row.date),
      amount: row.amount,
      mcAmount: update.mc_amount,
      lookup,
    });
    if (value !== row.mc_budget_amount) {
      update.mc_budget_amount = value;
    }
  }
  await lookup.flush();

  await batchMessages(async () => {
    await db.update('accounts', { id, mc_currency: code });
    for (const update of updates) {
      await db.updateTransaction(update);
    }
  });
  return { updated: updates.length, missingRates };
}

/**
 * Fills conversions that were pending because no rate was available: budget
 * amounts left at 0 and account-currency amounts left empty.
 */
export async function recomputePending(): Promise<{
  updated: number;
  stillPending: number;
}> {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    return { updated: 0, stillPending: 0 };
  }
  const foreign = await loadForeignAccounts(budgetCurrency);
  const updates: Array<{ id: string; amount?: number; mc_amount?: number }> =
    [];
  let stillPending = 0;
  const lookup = createMonthRateLookup();

  for (const [accountId, currency] of foreign) {
    const rows = await db.all<BackfillRow>(
      `SELECT ${BACKFILL_FIELDS} FROM v_transactions_internal_alive
        WHERE account = ? AND (
          (amount = 0 AND mc_amount IS NOT NULL AND mc_amount != 0) OR
          (mc_amount IS NULL AND amount != 0))`,
      [accountId],
    );
    if (rows.length === 0) {
      continue;
    }
    for (const row of rows) {
      const date = db.fromDateRepr(row.date);
      if (row.mc_amount != null) {
        const amount = await lookup.convert(
          row.mc_amount,
          date,
          currency,
          budgetCurrency,
        );
        if (amount == null) {
          stillPending++;
        } else {
          updates.push({ id: row.id, amount });
        }
      } else {
        const mcAmount = await lookup.convert(
          row.amount,
          date,
          budgetCurrency,
          currency,
        );
        if (mcAmount == null) {
          stillPending++;
        } else {
          updates.push({ id: row.id, mc_amount: mcAmount });
        }
      }
    }
  }

  await lookup.flush();

  // [fork:mc D-017] Values counted in a budget's currency that waited for
  // a rate: 0 while the transaction's own amount isn't (an exchange rate
  // adjustment, 0 in its account's currency, counts 0 there)
  const waiting = 'mc_budget_amount = 0 AND COALESCE(mc_amount, amount) != 0';
  const budgetUpdates = await getBudgetValueUpdates({
    where: waiting,
    params: [],
  });
  const waitingCount = await db.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM v_transactions_internal_alive
      WHERE ${waiting}`,
  );
  // Rows whose value is unchanged still wait
  stillPending += (waitingCount?.count ?? 0) - budgetUpdates.length;

  if (updates.length > 0 || budgetUpdates.length > 0) {
    await batchMessages(async () => {
      for (const update of [...updates, ...budgetUpdates]) {
        await db.updateTransaction(update);
      }
    });
  }
  return { updated: updates.length + budgetUpdates.length, stillPending };
}
