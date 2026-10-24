// [fork:mc D-005] Account-level multi-currency operations.
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { getDecimalPlaces } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { convertMinorUnits, isCurrencyCode } from '#shared/multi-currency';
import { amountToInteger } from '#shared/util';

import { getBudgetValue, getBudgetValueUpdates } from './budget-currency';
import { createMonthRateLookup, loadBudgetCurrencies } from './month-rates';
import { convertAmount, getMultiCurrencyContext } from './rates';
import { loadForeignAccounts } from './transactions';

/**
 * The currency to store on an account: null when the feature is off or the
 * code is invalid. The default currency is stored too: such an account
 * works like one without a currency until the default changes, and then
 * keeps its own (see `setAccountCurrency`).
 */
export async function normalizeAccountCurrency(
  currency: string | null | undefined,
): Promise<string | null> {
  if (!currency || !isCurrencyCode(currency)) {
    return null;
  }
  const { enabled } = await getMultiCurrencyContext();
  return enabled ? currency : null;
}

const NOTE_CURRENCY_TAG = /#currency:[A-Za-z]{3}\b/g;

/**
 * An account note carrying `currency` in the docs' `#currency:XXX` format:
 * the first tag replaced (any others removed), or the tag added on a line
 * of its own.
 */
export function withCurrencyTag(
  note: string | null | undefined,
  currency: string,
): string {
  const tag = `#currency:${currency}`;
  if (!note?.trim()) {
    return tag;
  }
  const tags = note.match(NOTE_CURRENCY_TAG) ?? [];
  if (tags.length === 0) {
    return `${note.trimEnd()}\n\n${tag}`;
  }
  if (tags.length === 1 && tags[0] === tag) {
    return note;
  }
  let isFirst = true;
  const replaced = note.replace(NOTE_CURRENCY_TAG, () => {
    const replacement = isFirst ? tag : '';
    isFirst = false;
    return replacement;
  });
  return tags.length === 1
    ? replaced
    : replaced
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

/**
 * Puts each account's currency in its note (`#currency:XXX`), for accounts
 * that have one. Notes of accounts without a currency are left alone: a tag
 * there is the user's (the docs workaround) and suggests a currency when
 * the default changes. With `accountIds`, only those accounts.
 */
export async function syncAccountCurrencyNotes(
  accountIds?: string[],
): Promise<number> {
  const { enabled } = await getMultiCurrencyContext();
  if (!enabled) {
    return 0;
  }
  const rows = await db.all<{
    id: string;
    mc_currency: string;
    note: string | null;
  }>(
    `SELECT a.id, a.mc_currency, n.note FROM accounts a
      LEFT JOIN notes n ON n.id = 'account-' || a.id
      WHERE a.tombstone = 0 AND a.mc_currency IS NOT NULL`,
  );
  const only = accountIds ? new Set(accountIds) : null;
  const updates = rows
    .filter(row => !only || only.has(row.id))
    .map(row => ({
      id: `account-${row.id}`,
      note: withCurrencyTag(row.note, row.mc_currency),
      old: row.note,
    }))
    .filter(update => update.note !== update.old);
  if (updates.length > 0) {
    await batchMessages(async () => {
      for (const { id, note } of updates) {
        await db.update('notes', { id, note });
      }
    });
  }
  return updates.length;
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
  const { budgetCurrency } = await getMultiCurrencyContext();
  if (!currency || currency === budgetCurrency) {
    return { amount: amountToInteger(balance) };
  }
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
  transfer_id: string | null;
};

const BACKFILL_FIELDS =
  'id, amount, mc_amount, date, notes, is_parent, parent_id, category, mc_budget_amount, transfer_id';

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
 * An account's amounts keep their numbers in another currency: `from`'s
 * minor units become `to`'s, and the value in the default currency is
 * worked out again at each month's rate. A split's value is the sum of its
 * children's; a transfer keeps the value of the other account's side.
 */
async function keepAccountNumbers({
  id,
  rows,
  from,
  to,
  lookup,
}: {
  id: string;
  rows: BackfillRow[];
  from: string;
  to: string;
  lookup: ReturnType<typeof createMonthRateLookup>;
}): Promise<{ updates: AccountCurrencyUpdate[]; missingRates: number }> {
  const { budgetCurrency } = await getMultiCurrencyContext();
  let missingRates = 0;
  const own = new Map<string, number | null>();
  for (const row of rows) {
    const value =
      from === budgetCurrency
        ? row.amount
        : (row.mc_amount ??
          (await lookup.convert(
            row.amount,
            db.fromDateRepr(row.date),
            budgetCurrency,
            from,
          )));
    own.set(
      row.id,
      value == null ? null : convertMinorUnits(value, 1, from, to),
    );
  }
  balanceSplits(rows, own);

  const amounts = new Map<string, number>();
  for (const row of rows) {
    const value = own.get(row.id);
    if (value == null) {
      missingRates++;
      continue;
    }
    const amount = await lookup.convert(
      value,
      db.fromDateRepr(row.date),
      to,
      budgetCurrency,
    );
    if (amount == null) {
      missingRates++;
    }
    amounts.set(row.id, amount ?? 0);
  }
  for (const parent of rows.filter(row => row.is_parent === 1)) {
    const children = rows.filter(row => row.parent_id === parent.id);
    if (children.length > 0) {
      amounts.set(
        parent.id,
        children.reduce((sum, child) => sum + (amounts.get(child.id) ?? 0), 0),
      );
    }
  }
  const transfers = rows.filter(row => row.transfer_id);
  if (transfers.length > 0) {
    const others = await db.all<{
      id: string;
      account: string;
      amount: number;
    }>(
      `SELECT id, account, amount FROM v_transactions_internal_alive
        WHERE id IN (${transfers.map(() => '?').join(', ')})`,
      transfers.map(row => row.transfer_id as string),
    );
    const otherById = new Map(others.map(row => [row.id, row]));
    for (const row of transfers) {
      const other = otherById.get(row.transfer_id as string);
      if (other && other.account !== id) {
        amounts.set(row.id, -other.amount);
      }
    }
  }

  const updates: AccountCurrencyUpdate[] = [];
  for (const row of rows) {
    const value = own.get(row.id);
    if (value == null) {
      continue;
    }
    updates.push({
      id: row.id,
      amount: amounts.get(row.id) ?? row.amount,
      mc_amount: to === budgetCurrency ? null : value,
    });
  }
  return { updates, missingRates };
}

type AccountCurrencyUpdate = {
  id: string;
  amount?: number;
  mc_amount: number | null;
  mc_budget_amount?: number | null;
};

/**
 * Sets an account's currency. With `convert` (the default) its transactions
 * keep their value in the default currency and get amounts in the new
 * currency: from workaround notes when present, otherwise converted at the
 * rate of each transaction's month. Without it, they keep their numbers,
 * now read in the new currency (an account set up in the wrong currency),
 * and their default-currency value is worked out again; a transfer keeps
 * matching the other account. [fork:mc D-017] Values counted in budgets of
 * another currency follow the new account amounts.
 *
 * [fork:mc D-012] The currency is stored as given, the default one too, and
 * written in the account's note (`#currency:XXX`). Giving an account without
 * one the default currency changes no amount: from then on it keeps that
 * currency when the default changes.
 */
export async function setAccountCurrency({
  id,
  currency,
  convert = true,
}: {
  id: string;
  currency: string | null;
  convert?: boolean;
}): Promise<{ updated: number; missingRates: number }> {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    throw new Error('Multi-currency is not enabled');
  }
  if (currency && !isCurrencyCode(currency)) {
    throw new Error(`Invalid currency: ${JSON.stringify(currency)}`);
  }
  const code = currency && currency !== budgetCurrency ? currency : null;
  const accountRow = await db.first<
    Pick<db.DbAccount, 'offbudget' | 'mc_currency'>
  >('SELECT offbudget, mc_currency FROM accounts WHERE id = ?', [id]);
  const from = accountRow?.mc_currency || budgetCurrency;
  const to = code ?? budgetCurrency;

  // [fork:mc D-012] Same currency: only the stored one changes
  const rows =
    from === to
      ? []
      : await db.all<BackfillRow>(
          `SELECT ${BACKFILL_FIELDS} FROM v_transactions_internal_alive
            WHERE account = ?`,
          [id],
        );

  let updates: AccountCurrencyUpdate[] = [];
  let missingRates = 0;
  const lookup = createMonthRateLookup();
  if (from === to) {
    // Nothing to convert
  } else if (!convert) {
    const kept = await keepAccountNumbers({ id, rows, from, to, lookup });
    updates = kept.updates;
    missingRates = kept.missingRates;
  } else if (code) {
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
      amount: update.amount ?? row.amount,
      mcAmount: update.mc_amount,
      lookup,
    });
    if (value !== row.mc_budget_amount) {
      update.mc_budget_amount = value;
    }
  }
  await lookup.flush();

  await batchMessages(async () => {
    // [fork:mc D-012]
    await db.update('accounts', { id, mc_currency: currency || null });
    for (const update of updates) {
      await db.updateTransaction(update);
    }
  });
  await syncAccountCurrencyNotes([id]);
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

export type AccountTotals = {
  all: number;
  onBudget: number;
  offBudget: number;
  closed: number;
};

/**
 * Account totals in `currency`: each account's balance in its own currency
 * at today's rate, added up like upstream's totals (All accounts, On budget
 * and Off budget leave closed accounts out). Null while multi-currency is
 * off; an account whose currency has no rate yet counts as 0.
 */
export async function getAccountTotals({
  currency,
}: {
  currency: string;
}): Promise<AccountTotals | null> {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled || !isCurrencyCode(currency)) {
    return null;
  }
  const rows = await db.all<{
    mc_currency: string | null;
    offbudget: 0 | 1;
    closed: 0 | 1;
    amount: number | null;
    mc_amount: number | null;
  }>(
    `SELECT a.mc_currency, a.offbudget, a.closed,
        SUM(t.amount) AS amount, SUM(t.mc_amount) AS mc_amount
      FROM accounts a
      LEFT JOIN v_transactions_internal_alive t
        ON t.account = a.id AND t.is_parent = 0
      WHERE a.tombstone = 0
      GROUP BY a.id`,
  );
  const today = monthUtils.currentDay();
  const totals: AccountTotals = {
    all: 0,
    onBudget: 0,
    offBudget: 0,
    closed: 0,
  };
  for (const row of rows) {
    const own = row.mc_currency || budgetCurrency;
    const balance = (own === budgetCurrency ? row.amount : row.mc_amount) ?? 0;
    const value = (await convertAmount(balance, today, own, currency)) ?? 0;
    if (row.closed === 1) {
      totals.closed += value;
      continue;
    }
    totals.all += value;
    if (row.offbudget === 1) {
      totals.offBudget += value;
    } else {
      totals.onBudget += value;
    }
  }
  return totals;
}
