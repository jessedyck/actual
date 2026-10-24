// [fork:mc D-018] Amounts in rules, schedules and filters are in the
// transaction's account currency.
//
// For a transaction in an account whose currency isn't the default one,
// rules see `amount` as its account-currency amount (in hundredths, like
// every amount a rule holds). A rule that changes the amount changes that
// account amount; the default-currency value is worked out again. A
// schedule's amount is in its account's currency, and so are amount
// conditions in filters.
import * as db from '#server/db';
import {
  hundredthsToMinorUnits,
  minorUnitsToHundredths,
} from '#shared/multi-currency';

import { createMonthRateLookup } from './month-rates';
import type { MonthRateLookup } from './month-rates';
import { getMultiCurrencyContextSync } from './rates';

type RuleAmounts = {
  amount?: number;
  mc_amount?: number | null;
  date?: string;
  subtransactions?: RuleAmounts[];
};

/** An account's currency when it isn't the default one, else null. */
export function getForeignCurrency(
  accountId: string | null | undefined,
  accounts: Map<string, Pick<db.DbAccount, 'mc_currency'>>,
): string | null {
  const currency = accountId ? accounts.get(accountId)?.mc_currency : null;
  if (!currency) {
    return null;
  }
  const context = getMultiCurrencyContextSync();
  return context.enabled && currency !== context.budgetCurrency
    ? currency
    : null;
}

/**
 * A transaction with its account-currency amount as `amount`, for code that
 * reads amounts the way rules do (schedule discovery).
 */
export function withAccountAmount<
  T extends {
    account?: string | null;
    amount: number;
    mc_amount?: number | null;
  },
>(transaction: T): T {
  if (transaction.mc_amount == null || !transaction.account) {
    return transaction;
  }
  const row = db.firstSync<Pick<db.DbAccount, 'mc_currency'>>(
    'SELECT mc_currency FROM accounts WHERE id = ?',
    [transaction.account],
  );
  const currency = getForeignCurrency(
    transaction.account,
    new Map([[transaction.account, { mc_currency: row?.mc_currency ?? null }]]),
  );
  return currency
    ? {
        ...transaction,
        amount: minorUnitsToHundredths(transaction.mc_amount, currency),
      }
    : transaction;
}

/**
 * The transaction as rules see it: its account-currency amount as `amount`.
 * Null when there is nothing to change (an account in the default
 * currency, or no account amount stored yet).
 */
export function toRulesView<T extends RuleAmounts>(
  transaction: T,
  currency: string | null,
): T | null {
  if (!currency || transaction.mc_amount == null) {
    return null;
  }
  return {
    ...transaction,
    amount: minorUnitsToHundredths(transaction.mc_amount, currency),
  };
}

/**
 * Back from what rules saw. An unchanged amount gets its stored values
 * back; a changed one is the new account amount, with its value in the
 * default currency at the month's rate when that rate is known (else 0,
 * which saving fills in). Children a split rule made get both amounts and
 * add up to their parent.
 */
export async function fromRulesView<T extends RuleAmounts>(
  result: T,
  original: RuleAmounts,
  view: RuleAmounts,
  currency: string,
): Promise<T> {
  const { budgetCurrency } = getMultiCurrencyContextSync();
  // Read-only: rules may run outside a mutator, so nothing is fetched or
  // stored here
  const lookup = createMonthRateLookup({ allowFetch: false });
  const date = result.date ?? original.date;
  const toDefault = async (mcAmount: number) =>
    date
      ? ((await lookup.convert(mcAmount, date, currency, budgetCurrency)) ?? 0)
      : 0;

  const next: T = { ...result };
  if (result.amount === view.amount) {
    next.amount = original.amount;
    next.mc_amount = original.mc_amount;
  } else {
    const mcAmount = hundredthsToMinorUnits(result.amount ?? 0, currency);
    next.mc_amount = mcAmount;
    next.amount = await toDefault(mcAmount);
  }

  if (
    result.subtransactions &&
    result.subtransactions !== original.subtransactions
  ) {
    const children: RuleAmounts[] = [];
    for (const child of result.subtransactions) {
      if (child.mc_amount != null) {
        children.push(child);
        continue;
      }
      const mcAmount = hundredthsToMinorUnits(child.amount ?? 0, currency);
      children.push({
        ...child,
        mc_amount: mcAmount,
        amount: await toDefault(mcAmount),
      });
    }
    const total = children.reduce((sum, child) => sum + (child.amount ?? 0), 0);
    const difference = (next.amount ?? 0) - total;
    if (
      difference !== 0 &&
      children.length > 0 &&
      Math.abs(difference) <= children.length
    ) {
      const largest = children.reduce((a, b) =>
        Math.abs(b.amount ?? 0) > Math.abs(a.amount ?? 0) ? b : a,
      );
      largest.amount = (largest.amount ?? 0) + difference;
    }
    next.subtransactions = children;
  }
  return next;
}

/**
 * The amounts of a transaction a schedule posts: the schedule's amount is in
 * its account's currency, and the default-currency value is derived on save
 * (D-006).
 */
export function getScheduledTransactionAmounts(
  amount: number,
  currency: string | null,
): { amount: number; mc_amount?: number } {
  return currency
    ? { amount: 0, mc_amount: hundredthsToMinorUnits(amount, currency) }
    : { amount };
}

/**
 * The amounts of a transaction a schedule would post, for forecasts: the
 * account amount and its default-currency value at the month's rate (0
 * while no rate is stored). Nothing is fetched or stored.
 */
export async function getForecastTransactionAmounts(
  amount: number,
  currency: string | null,
  date: string,
  lookup: MonthRateLookup,
): Promise<{ amount: number; mc_amount?: number }> {
  if (!currency) {
    return { amount };
  }
  const mcAmount = hundredthsToMinorUnits(amount, currency);
  const { budgetCurrency } = getMultiCurrencyContextSync();
  return {
    amount:
      (await lookup.convert(mcAmount, date, currency, budgetCurrency)) ?? 0,
    mc_amount: mcAmount,
  };
}

function renameAmount(filter: unknown): unknown {
  if (Array.isArray(filter)) {
    return filter.map(renameAmount);
  }
  if (filter && typeof filter === 'object') {
    return Object.fromEntries(
      Object.entries(filter).map(([key, value]) => [
        key === 'amount' ? 'mc_amount' : key,
        renameAmount(value),
      ]),
    );
  }
  return filter;
}

/**
 * A filter made from an amount condition, compared with each transaction's
 * account-currency amount: `amount` for accounts in the default currency,
 * `mc_amount` for the others.
 */
export function toAccountCurrencyAmountFilter(
  field: string | undefined,
  filter: unknown,
): unknown {
  if (field !== 'amount') {
    return filter;
  }
  const context = getMultiCurrencyContextSync();
  if (!context.enabled) {
    return filter;
  }
  // An account can store the default currency (D-012)
  const isDefault = {
    $or: [
      { 'account.mc_currency': null },
      { 'account.mc_currency': context.budgetCurrency },
    ],
  };
  return {
    $or: [
      { $and: [isDefault, filter] },
      {
        $and: [
          { 'account.mc_currency': { $ne: null } },
          { 'account.mc_currency': { $ne: context.budgetCurrency } },
          renameAmount(filter),
        ],
      },
    ],
  };
}
