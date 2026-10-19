// [fork:mc D-017] A currency on each budget.
//
// A category's budget in a month can be in its own currency; spending in it
// counts in that currency (`mc_budget_amount`), converted at the month's
// rate when the transaction's account is in another one. See
// `month-rates.ts` for how rates and the budget spreadsheet use this.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { batchMessages } from '#server/sync';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { convertMinorUnits, isCurrencyCode } from '#shared/multi-currency';

import {
  createMonthRateLookup,
  ensureBudgetFactorRates,
  getBudgetCurrencyOf,
  getBudgetTable,
  loadAccountCurrencies,
  loadBudgetCurrencies,
} from './month-rates';
import type { BudgetCurrencies, MonthRateLookup } from './month-rates';
import { getMultiCurrencyContext } from './rates';
import type { MultiCurrencyContext } from './rates';

export function isSupportedCurrency(
  code: string | null | undefined,
): code is string {
  return isCurrencyCode(code) && getCurrency(code).code === code;
}

type BudgetValueRow = {
  id: string;
  account: string;
  category: string | null;
  date: number;
  amount: number;
  mc_amount: number | null;
  mc_budget_amount: number | null;
  is_parent: 0 | 1;
};

/**
 * A transaction's value in its budget's currency, or null when its budget
 * is in the default currency (or it has none). 0 while no rate is known.
 */
export async function getBudgetValue({
  context,
  budgets,
  accountCurrency,
  isOffBudget,
  category,
  date,
  amount,
  mcAmount,
  lookup,
}: {
  context: MultiCurrencyContext;
  budgets: BudgetCurrencies;
  accountCurrency: string;
  isOffBudget: boolean;
  category: string | null | undefined;
  date: string;
  amount: number;
  mcAmount: number | null;
  lookup: MonthRateLookup;
}): Promise<number | null> {
  const defaultCurrency = context.budgetCurrency;
  if (!category || isOffBudget) {
    return null;
  }
  const budgetCurrency = getBudgetCurrencyOf(context, budgets, category, date);
  if (budgetCurrency === defaultCurrency) {
    return null;
  }
  const own = accountCurrency === defaultCurrency ? amount : mcAmount;
  if (own == null) {
    return 0;
  }
  if (accountCurrency === budgetCurrency) {
    return own;
  }
  return (
    (await lookup.convert(own, date, accountCurrency, budgetCurrency)) ?? 0
  );
}

/**
 * Recomputes the budget-currency value of the transactions matching
 * `where`, with `budgets` standing for the budgets' currencies (pass the
 * new ones when they are about to change). Writes nothing itself: returns
 * the updates.
 */
export async function getBudgetValueUpdates({
  where,
  params,
  budgets,
  context,
}: {
  where: string;
  params: Array<string | number>;
  budgets?: BudgetCurrencies;
  context?: MultiCurrencyContext;
}): Promise<Array<{ id: string; mc_budget_amount: number | null }>> {
  const ctx = context ?? (await getMultiCurrencyContext());
  if (!ctx.enabled) {
    return [];
  }
  const currencies = budgets ?? (await loadBudgetCurrencies());
  const accounts = await loadAccountCurrencies(ctx.budgetCurrency);
  const offBudget = new Set(
    (
      await db.all<Pick<db.DbAccount, 'id'>>(
        'SELECT id FROM accounts WHERE offbudget = 1 AND tombstone = 0',
      )
    ).map(row => row.id),
  );
  const rows = await db.all<BudgetValueRow>(
    `SELECT id, account, category, date, amount, mc_amount, mc_budget_amount,
        is_parent
      FROM v_transactions_internal_alive WHERE ${where}`,
    params,
  );
  const lookup = createMonthRateLookup();
  const updates: Array<{ id: string; mc_budget_amount: number | null }> = [];
  for (const row of rows) {
    const value =
      row.is_parent === 1
        ? null
        : await getBudgetValue({
            context: ctx,
            budgets: currencies,
            accountCurrency: accounts.get(row.account) ?? ctx.budgetCurrency,
            isOffBudget: offBudget.has(row.account),
            category: row.category,
            date: db.fromDateRepr(row.date),
            amount: row.amount,
            mcAmount: row.mc_amount,
            lookup,
          });
    if (value !== row.mc_budget_amount) {
      updates.push({ id: row.id, mc_budget_amount: value });
    }
  }
  await lookup.flush();
  return updates;
}

function dbMonth(month: string): number {
  return parseInt(month.replace('-', ''));
}

/**
 * Sets the currency of a category's budget for a month (null: the default
 * currency). With `convert`, the budgeted amount and goal are converted at
 * the month's rate; otherwise they keep their numbers. Spending in that
 * budget is counted again in the new currency.
 */
export async function setBudgetCurrency({
  month,
  category,
  currency,
  convert = false,
}: {
  month: string;
  category: string;
  currency: string | null;
  convert?: boolean;
}): Promise<{ amount: number; currency: string }> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    throw APIError('Multi-currency is not enabled');
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw APIError(`Invalid month: ${JSON.stringify(month)}`);
  }
  if (currency !== null && !isSupportedCurrency(currency)) {
    throw APIError(`Invalid currency: ${JSON.stringify(currency)}`);
  }
  const table = getBudgetTable();
  const existing = await db.first<{
    id: string;
    amount: number | null;
    goal: number | null;
  }>(`SELECT id, amount, goal FROM ${table} WHERE month = ? AND category = ?`, [
    dbMonth(month),
    category,
  ]);

  const budgets = await loadBudgetCurrencies();
  const before = getBudgetCurrencyOf(context, budgets, category, month);
  const after = currency ?? context.budgetCurrency;
  const key = `${month}:${category}`;
  if (currency) {
    budgets.set(key, currency);
  } else {
    budgets.delete(key);
  }

  let amount = existing?.amount ?? 0;
  let goal = existing?.goal ?? null;
  if (convert && before !== after) {
    const lookup = createMonthRateLookup();
    const converted = await lookup.convert(amount, month, before, after);
    if (converted == null) {
      throw APIError(
        `No exchange rate from ${before} to ${after} is available. Turn on automatic rate downloads or add a rate first.`,
      );
    }
    amount = converted;
    if (goal != null) {
      goal = (await lookup.convert(goal, month, before, after)) ?? goal;
    }
    await lookup.flush();
  }

  const { start, end } = monthUtils.bounds(month);
  const updates = await getBudgetValueUpdates({
    where: 'category = ? AND date >= ? AND date <= ?',
    params: [category, start, end],
    budgets,
    context,
  });

  await batchMessages(async () => {
    if (existing) {
      await db.update(table, {
        id: existing.id,
        mc_currency: currency,
        ...(convert ? { amount, goal } : {}),
      });
    } else {
      await db.insert(table, {
        id: `${dbMonth(month)}-${category}`,
        month: dbMonth(month),
        category,
        amount: 0,
        mc_currency: currency,
      });
    }
    for (const update of updates) {
      await db.updateTransaction(update);
    }
  });
  await ensureBudgetFactorRates();
  return { amount, currency: after };
}

/**
 * Gives the budgets of `toMonth` the currencies of `fromMonth`'s (for the
 * given categories), as copying last month's budget copies its amounts.
 * Must run inside the batch that copies the amounts.
 */
export async function copyBudgetCurrencies({
  fromMonth,
  toMonth,
  categories,
}: {
  fromMonth: string;
  toMonth: string;
  categories: string[];
}): Promise<void> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled || categories.length === 0) {
    return;
  }
  const table = getBudgetTable();
  const budgets = await loadBudgetCurrencies();
  const targets = new Map(
    (
      await db.all<{ id: string; category: string }>(
        `SELECT id, category FROM ${table} WHERE month = ?`,
        [dbMonth(toMonth)],
      )
    ).map(row => [row.category, row.id]),
  );

  const changed: string[] = [];
  for (const category of categories) {
    const from = budgets.get(`${fromMonth}:${category}`) ?? null;
    const to = budgets.get(`${toMonth}:${category}`) ?? null;
    if (from === to) {
      continue;
    }
    const id = targets.get(category) ?? `${dbMonth(toMonth)}-${category}`;
    if (targets.has(category)) {
      await db.update(table, { id, mc_currency: from });
    } else {
      await db.insert(table, {
        id,
        month: dbMonth(toMonth),
        category,
        mc_currency: from,
      });
    }
    if (from) {
      budgets.set(`${toMonth}:${category}`, from);
    } else {
      budgets.delete(`${toMonth}:${category}`);
    }
    changed.push(category);
  }
  if (changed.length === 0) {
    return;
  }
  const { start, end } = monthUtils.bounds(toMonth);
  const updates = await getBudgetValueUpdates({
    where: `date >= ? AND date <= ? AND category IN (${changed.map(() => '?').join(', ')})`,
    params: [start, end, ...changed],
    budgets,
    context,
  });
  for (const update of updates) {
    await db.updateTransaction(update);
  }
}

/**
 * Multiplier from a category's budget currency in `fromMonth` to its
 * currency in `toMonth`, at `toMonth`'s rate (1 when they match).
 */
export async function getBudgetConversion({
  category,
  fromMonth,
  toMonth,
}: {
  category: string;
  fromMonth: string;
  toMonth: string;
}): Promise<(amount: number) => number> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    return amount => amount;
  }
  const budgets = await loadBudgetCurrencies();
  const from = getBudgetCurrencyOf(context, budgets, category, fromMonth);
  const to = getBudgetCurrencyOf(context, budgets, category, toMonth);
  if (from === to) {
    return amount => amount;
  }
  const lookup = createMonthRateLookup();
  const found = await lookup.get(toMonth, from, to);
  await lookup.flush();
  if (!found) {
    return amount => amount;
  }
  return amount => convertMinorUnits(amount, found.rate, from, to);
}
