// [fork:mc D-005] Account-level multi-currency operations.
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { getDecimalPlaces } from '#shared/currencies';
import { isCurrencyCode } from '#shared/multi-currency';
import { amountToInteger } from '#shared/util';

import { convertAmount, ensureRates, getMultiCurrencyContext } from './rates';
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
  const amount =
    (await convertAmount(mcAmount, date, currency, budgetCurrency)) ?? 0;
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

type BackfillRow = {
  id: string;
  amount: number;
  mc_amount: number | null;
  date: number;
  notes: string | null;
  is_parent: 0 | 1;
  parent_id: string | null;
};

const BACKFILL_FIELDS =
  'id, amount, mc_amount, date, notes, is_parent, parent_id';

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
 * converting the budget amount at each transaction's date. Setting the
 * budget currency (or null) clears them.
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

  const updates: Array<{ id: string; mc_amount: number | null }> = [];
  let missingRates = 0;
  if (code) {
    await ensureRates(
      code,
      budgetCurrency,
      rows.map(row => db.fromDateRepr(row.date)),
    );
    const values = new Map<string, number | null>();
    for (const row of rows) {
      const fromNote = parseWorkaroundNote(row.notes, code);
      const mcAmount =
        fromNote ??
        (await convertAmount(
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
    await ensureRates(
      currency,
      budgetCurrency,
      rows.map(row => db.fromDateRepr(row.date)),
    );
    for (const row of rows) {
      const date = db.fromDateRepr(row.date);
      if (row.mc_amount != null) {
        const amount = await convertAmount(
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
        const mcAmount = await convertAmount(
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

  if (updates.length > 0) {
    await batchMessages(async () => {
      for (const update of updates) {
        await db.updateTransaction(update);
      }
    });
  }
  return { updated: updates.length, stillPending };
}
