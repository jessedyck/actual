// [fork:mc D-017] Exchange rates by month, and budgets in other currencies.
//
// Money counted in another currency than its own converts at the rate of
// its month: the average of the month's daily rates, or a rate the user
// typed. Until a month ends its rate is the average so far (before its first
// daily rate, the latest one before it), so that month's converted values
// move a little each day; once the month is over the average is final.
// Rates live in the synced preference `mcMonthRates`, so every device
// converts with the same numbers.
//
// A category's budget in a month can have a currency of its own
// (`mc_currency` on `zero_budgets` / `reflect_budgets`). Without one it is
// in the default currency. A categorized transaction's value in its
// budget's currency is kept in `mc_budget_amount` whenever that isn't the
// default currency, and the budget sums it. To Budget and group totals stay in the default currency:
// each category's figures are converted by its `mc-todef-<id>` cell, and a
// balance carried into a month where the budget's currency differs by its
// `mc-carry-<id>` cell.
import * as db from '#server/db';
import { withMutatorContext } from '#server/mutators';
import * as sheet from '#server/sheet';
import { resolveName } from '#server/spreadsheet/util';
import { batchMessages } from '#server/sync';
import * as monthUtils from '#shared/months';
import {
  convertMinorUnits,
  findMonthRate,
  getCarryFactor,
  makeMonthRateId,
  MC_PREF_MONTH_RATES,
  parseMonthRates,
  roundHalfAwayFromZero,
} from '#shared/multi-currency';
import type { StoredMonthRate, StoredMonthRates } from '#shared/multi-currency';

import {
  ensureRates,
  getMultiCurrencyContext,
  getMultiCurrencyContextSync,
  getRate,
} from './rates';
import type { MultiCurrencyContext } from './rates';

/** Spreadsheet cell converting a category's figures to the default currency */
export function toDefaultCell(categoryId: string): string {
  return `mc-todef-${categoryId}`;
}

/** Spreadsheet cell converting a balance carried in from last month */
export function carryCell(categoryId: string): string {
  return `mc-carry-${categoryId}`;
}

export type MonthRate = {
  /** 1 base = rate quote */
  rate: number;
  manual: boolean;
  final: boolean;
};

// Stored rates

export async function loadMonthRates(): Promise<StoredMonthRates> {
  const row = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    [MC_PREF_MONTH_RATES],
  );
  return parseMonthRates(row?.value);
}

function loadMonthRatesSync(): StoredMonthRates {
  const row = db.firstSync<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    [MC_PREF_MONTH_RATES],
  );
  return parseMonthRates(row?.value);
}

/** Sorted, so the stored text only changes when a rate does. */
function serialize(rates: StoredMonthRates): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(rates)
        .sort()
        .map(key => [key, rates[key]]),
    ),
  );
}

async function writeMonthRates(rates: StoredMonthRates): Promise<void> {
  await db.update('preferences', {
    id: MC_PREF_MONTH_RATES,
    value: serialize(rates),
  });
}

/** Rates are compared and stored with 8 significant digits. */
function roundRate(rate: number): number {
  return Number(rate.toPrecision(8));
}

function isSameRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * 1e-9;
}

/** One stored daily rate per day within [from, to], manual ones first. */
async function getDailyRates(
  base: string,
  quote: string,
  from: string,
  to: string,
): Promise<number[]> {
  const rows = await db.all<
    Pick<db.DbMcExchangeRate, 'date' | 'base' | 'rate' | 'source'>
  >(
    `SELECT date, base, rate, source FROM mc_exchange_rates
      WHERE tombstone = 0 AND rate > 0 AND date >= ? AND date <= ?
        AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
      ORDER BY date,
        CASE WHEN source = 'manual' THEN 1 ELSE 0 END,
        CASE WHEN base = ? THEN 1 ELSE 0 END`,
    [db.toDateRepr(from), db.toDateRepr(to), base, quote, quote, base, base],
  );
  // The ordering puts each day's preferred row last
  const byDay = new Map<number, number>();
  for (const row of rows) {
    byDay.set(row.date, row.base === base ? row.rate : 1 / row.rate);
  }
  return [...byDay.values()];
}

/**
 * The average of a month's daily rates so far. A month that hasn't started,
 * or has no rate yet, takes the latest rate before it. Final once the month
 * is over and its last week has rates.
 */
export async function computeMonthRate(
  month: string,
  base: string,
  quote: string,
  { allowFetch = true }: { allowFetch?: boolean } = {},
): Promise<{ rate: number; final: boolean } | null> {
  if (base === quote) {
    return { rate: 1, final: true };
  }
  const today = monthUtils.currentDay();
  const first = `${month}-01`;
  const last = monthUtils.lastDayOfMonth(first);
  // The latest rate on or before a day, however old
  const latest = async (day: string) => {
    const lookup = await getRate(day, base, quote, { allowFetch });
    if (lookup) {
      return { rate: roundRate(lookup.rate), final: false };
    }
    const row = await db.first<Pick<db.DbMcExchangeRate, 'base' | 'rate'>>(
      `SELECT base, rate FROM mc_exchange_rates
        WHERE tombstone = 0 AND rate > 0 AND date <= ?
          AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
        ORDER BY date DESC, CASE WHEN source = 'manual' THEN 0 ELSE 1 END
        LIMIT 1`,
      [db.toDateRepr(day), base, quote, quote, base],
    );
    return row
      ? {
          rate: roundRate(row.base === base ? row.rate : 1 / row.rate),
          final: false,
        }
      : null;
  };
  if (first > today) {
    return latest(today);
  }
  const end = last < today ? last : today;
  if (allowFetch) {
    await ensureRates(base, quote, monthUtils.dayRangeInclusive(first, end));
  }
  const rates = await getDailyRates(base, quote, first, end);
  if (rates.length === 0) {
    return latest(first);
  }
  const average = rates.reduce((total, rate) => total + rate, 0) / rates.length;
  const isOver = last < today;
  const final =
    isOver &&
    (await getDailyRates(base, quote, monthUtils.subDays(last, 6), last))
      .length > 0;
  return { rate: roundRate(average), final };
}

export type MonthRateLookup = {
  get: (
    month: string,
    base: string,
    quote: string,
  ) => Promise<MonthRate | null>;
  /** Minor units of `from` in `to` at the rate of the date's month, or null */
  convert: (
    amount: number,
    monthOrDate: string,
    from: string,
    to: string,
  ) => Promise<number | null>;
  /** Stores the rates computed so far (outside undo) */
  flush: () => Promise<void>;
};

/**
 * Looks month rates up, computing (and remembering) the ones not stored yet.
 * Call `flush` once done so every device converts with the same rates.
 */
export function createMonthRateLookup({
  allowFetch = true,
}: { allowFetch?: boolean } = {}): MonthRateLookup {
  let stored: StoredMonthRates | null = null;
  const added: StoredMonthRates = {};

  const get = async (
    month: string,
    base: string,
    quote: string,
  ): Promise<MonthRate | null> => {
    if (base === quote) {
      return { rate: 1, manual: false, final: true };
    }
    stored ??= await loadMonthRates();
    const found = findMonthRate({ ...stored, ...added }, month, base, quote);
    if (found) {
      return {
        rate: found.rate,
        manual: Boolean(found.manual),
        final: Boolean(found.final),
      };
    }
    const computed = await computeMonthRate(month, base, quote, {
      allowFetch,
    });
    if (!computed) {
      return null;
    }
    added[makeMonthRateId(month, base, quote)] = {
      rate: computed.rate,
      ...(computed.final ? { final: true } : {}),
    };
    return { rate: computed.rate, manual: false, final: computed.final };
  };

  return {
    get,
    convert: async (amount, monthOrDate, from, to) => {
      if (from === to) {
        return amount;
      }
      const found = await get(monthOrDate.slice(0, 7), from, to);
      return found ? convertMinorUnits(amount, found.rate, from, to) : null;
    },
    flush: async () => {
      if (Object.keys(added).length === 0) {
        return;
      }
      const current = await loadMonthRates();
      const merged: StoredMonthRates = { ...current };
      for (const [key, entry] of Object.entries(added)) {
        const [month, base, quote] = key.split(':');
        // Another write may have stored this month meanwhile
        if (!findMonthRate(current, month, base, quote)) {
          merged[key] = entry;
        }
      }
      for (const key of Object.keys(added)) {
        delete added[key];
      }
      stored = merged;
      await withMutatorContext({ undoListening: false }, () =>
        writeMonthRates(merged),
      );
    },
  };
}

// Accounts and budgets

/** Each account's currency: its own, else the default currency. */
export async function loadAccountCurrencies(
  defaultCurrency: string,
): Promise<Map<string, string>> {
  const rows = await db.all<Pick<db.DbAccount, 'id' | 'mc_currency'>>(
    'SELECT id, mc_currency FROM accounts WHERE tombstone = 0',
  );
  return new Map(rows.map(row => [row.id, row.mc_currency || defaultCurrency]));
}

export type BudgetTable = 'zero_budgets' | 'reflect_budgets';

export function getBudgetTable(): BudgetTable {
  const row = db.firstSync<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    ['budgetType'],
  );
  return row?.value === 'tracking' ? 'reflect_budgets' : 'zero_budgets';
}

/** `YYYY-MM` for a budget row's `month` (YYYYMM). */
export function monthOfBudgetRow(month: number): string {
  const text = String(month);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

/** Budgets with a currency of their own, by `month:category`. */
export type BudgetCurrencies = Map<string, string>;

export function budgetKey(month: string, categoryId: string): string {
  return `${month}:${categoryId}`;
}

export async function loadBudgetCurrencies(): Promise<BudgetCurrencies> {
  const rows = await db.all<{
    month: number;
    category: string;
    mc_currency: string;
  }>(
    `SELECT month, category, mc_currency FROM ${getBudgetTable()}
      WHERE mc_currency IS NOT NULL`,
  );
  return new Map(
    rows.map(row => [
      budgetKey(monthOfBudgetRow(row.month), row.category),
      row.mc_currency,
    ]),
  );
}

function loadBudgetCurrenciesSync(): BudgetCurrencies {
  const rows = db.runQuery<{
    month: number;
    category: string;
    mc_currency: string;
  }>(
    `SELECT month, category, mc_currency FROM ${getBudgetTable()}
      WHERE mc_currency IS NOT NULL`,
    [],
    true,
  );
  return new Map(
    rows.map(row => [
      budgetKey(monthOfBudgetRow(row.month), row.category),
      row.mc_currency,
    ]),
  );
}

/** The currency of a category's budget in a month. */
export function getBudgetCurrencyOf(
  context: MultiCurrencyContext,
  budgets: BudgetCurrencies,
  categoryId: string,
  monthOrDate: string,
): string {
  const month = monthOrDate.slice(0, 7);
  return budgets.get(budgetKey(month, categoryId)) ?? context.budgetCurrency;
}

// Re-converting after a rate change

type ConvertedRow = {
  id: string;
  account: string;
  category: string | null;
  amount: number;
  mc_amount: number | null;
  mc_budget_amount: number | null;
  transfer_id: string | null;
  is_parent: 0 | 1;
  is_child: 0 | 1;
  parent_id: string | null;
};

/**
 * After the rate between two currencies changed for a month, re-converts
 * the values that were computed with the old rate: budget amounts of
 * accounts in another currency than the default one, and values counted in
 * a budget's currency. A value typed by hand, or one mirroring the other
 * side of a transfer, doesn't match the old conversion and stays.
 */
async function reconvert({
  context,
  accounts,
  budgets,
  month,
  base,
  quote,
  oldRate,
  newRate,
}: {
  context: MultiCurrencyContext;
  accounts: Map<string, string>;
  budgets: BudgetCurrencies;
  month: string;
  base: string;
  quote: string;
  oldRate: number;
  newRate: number;
}): Promise<number> {
  if (isSameRate(oldRate, newRate)) {
    return 0;
  }
  const accountIds = [...accounts]
    .filter(([, code]) => code === base || code === quote)
    .map(([id]) => id);
  if (accountIds.length === 0) {
    return 0;
  }
  const { start, end } = monthUtils.bounds(month);
  const rows = await db.all<ConvertedRow>(
    `SELECT id, account, category, amount, mc_amount, mc_budget_amount,
        transfer_id, is_parent, is_child, parent_id
      FROM v_transactions_internal_alive
      WHERE date >= ? AND date <= ?
        AND account IN (${accountIds.map(() => '?').join(', ')})`,
    [start, end, ...accountIds],
  );
  const defaultCurrency = context.budgetCurrency;
  // Rate from `from` to `to` before and after, when the pair is base/quote
  const ratesFor = (from: string, to: string) =>
    from === base && to === quote
      ? [oldRate, newRate]
      : from === quote && to === base
        ? [1 / oldRate, 1 / newRate]
        : null;

  const amounts = new Map<string, number>();
  const budgetAmounts = new Map<string, number>();
  for (const row of rows) {
    const currency = accounts.get(row.account) ?? defaultCurrency;
    // The budget value in the default currency
    const toDefault = ratesFor(currency, defaultCurrency);
    if (toDefault && row.mc_amount != null) {
      const [before, after] = toDefault;
      if (
        row.amount ===
        convertMinorUnits(row.mc_amount, before, currency, defaultCurrency)
      ) {
        const next = convertMinorUnits(
          row.mc_amount,
          after,
          currency,
          defaultCurrency,
        );
        if (next !== row.amount) {
          amounts.set(row.id, next);
        }
      }
    }
    // The value in the budget's currency
    if (row.category && row.mc_budget_amount != null) {
      const budgetCurrency = getBudgetCurrencyOf(
        context,
        budgets,
        row.category,
        month,
      );
      const toBudget = ratesFor(currency, budgetCurrency);
      const own = row.mc_amount ?? row.amount;
      if (toBudget) {
        const [before, after] = toBudget;
        if (
          row.mc_budget_amount ===
          convertMinorUnits(own, before, currency, budgetCurrency)
        ) {
          const next = convertMinorUnits(own, after, currency, budgetCurrency);
          if (next !== row.mc_budget_amount) {
            budgetAmounts.set(row.id, next);
          }
        }
      }
    }
  }

  // Split children still add up to their parent
  for (const parent of rows.filter(row => row.is_parent === 1)) {
    const children = rows.filter(row => row.parent_id === parent.id);
    if (children.length === 0) {
      continue;
    }
    const parentAmount = amounts.get(parent.id) ?? parent.amount;
    const total = children.reduce(
      (sum, child) => sum + (amounts.get(child.id) ?? child.amount),
      0,
    );
    const difference = parentAmount - total;
    if (difference !== 0 && Math.abs(difference) <= children.length) {
      const largest = children.reduce((a, b) =>
        Math.abs(amounts.get(b.id) ?? b.amount) >
        Math.abs(amounts.get(a.id) ?? a.amount)
          ? b
          : a,
      );
      amounts.set(
        largest.id,
        (amounts.get(largest.id) ?? largest.amount) + difference,
      );
    }
  }

  // A transfer whose other side mirrored this one keeps mirroring it
  const byId = new Map(rows.map(row => [row.id, row]));
  const partnerIds = [...amounts.keys()]
    .map(id => byId.get(id)?.transfer_id)
    .filter((id): id is string => Boolean(id) && !amounts.has(id as string));
  if (partnerIds.length > 0) {
    const partners = await db.all<Pick<ConvertedRow, 'id' | 'amount'>>(
      `SELECT id, amount FROM v_transactions_internal_alive
        WHERE id IN (${partnerIds.map(() => '?').join(', ')})`,
      partnerIds,
    );
    for (const partner of partners) {
      const row = rows.find(item => item.transfer_id === partner.id);
      const next = row ? amounts.get(row.id) : undefined;
      if (row && next !== undefined && partner.amount === -row.amount) {
        amounts.set(partner.id, -next);
      }
    }
  }

  const ids = new Set([...amounts.keys(), ...budgetAmounts.keys()]);
  for (const id of ids) {
    await db.updateTransaction({
      id,
      ...(amounts.has(id) ? { amount: amounts.get(id) } : {}),
      ...(budgetAmounts.has(id)
        ? { mc_budget_amount: budgetAmounts.get(id) }
        : {}),
    });
  }
  return ids.size;
}

/** Month and currency pairs that conversions use from `fromMonth` on. */
async function getNeededPairs(
  context: MultiCurrencyContext,
  accounts: Map<string, string>,
  budgets: BudgetCurrencies,
  fromMonth: string,
): Promise<Map<string, { month: string; base: string; quote: string }>> {
  const needed = new Map<
    string,
    { month: string; base: string; quote: string }
  >();
  const add = (month: string, base: string, quote: string) => {
    if (base !== quote) {
      needed.set(makeMonthRateId(month, base, quote), { month, base, quote });
    }
  };
  const defaultCurrency = context.budgetCurrency;

  // Transactions: their account's currency to the default currency, and to
  // their budget's currency
  const rows = await db.all<{
    month: number;
    account: string;
    category: string | null;
  }>(
    `SELECT DISTINCT date / 100 AS month, account, category
      FROM v_transactions_internal_alive WHERE date >= ?`,
    [db.toDateRepr(`${fromMonth}-01`)],
  );
  for (const row of rows) {
    const month = monthOfBudgetRow(row.month);
    const currency = accounts.get(row.account) ?? defaultCurrency;
    add(month, currency, defaultCurrency);
    if (row.category) {
      add(
        month,
        currency,
        getBudgetCurrencyOf(context, budgets, row.category, month),
      );
    }
  }

  // What the budget spreadsheet converts with: budgets in other currencies
  // to the default currency, and balances carried across a change
  const created = sheet.get()?.meta().createdMonths ?? new Set<string>();
  const categories = await db.all<{ id: string }>(
    'SELECT id FROM categories WHERE tombstone = 0',
  );
  for (const pair of collectFactorPairs(
    context,
    budgets,
    categories.map(row => row.id),
    [...created].filter(month => month >= fromMonth),
  )) {
    add(pair.month, pair.from, pair.to);
  }
  return needed;
}

/**
 * Brings the rates of months that aren't over (and of last month, until its
 * average is final) up to date, re-converting the values computed with them.
 * Runs when a budget file opens; its writes are kept out of undo.
 */
export async function refreshMonthRates(): Promise<{ updated: number }> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    return { updated: 0 };
  }
  const accounts = await loadAccountCurrencies(context.budgetCurrency);
  const budgets = await loadBudgetCurrencies();
  const hasOtherCurrencies =
    budgets.size > 0 ||
    [...accounts.values()].some(code => code !== context.budgetCurrency);
  if (!hasOtherCurrencies) {
    return { updated: 0 };
  }

  const stored = await loadMonthRates();
  const fromMonth = monthUtils.prevMonth(monthUtils.currentMonth());
  const needed = await getNeededPairs(context, accounts, budgets, fromMonth);
  // Older months whose average wasn't final yet (the budget file wasn't
  // opened while they ended)
  for (const [key, entry] of Object.entries(stored)) {
    const [month, base, quote] = key.split(':');
    if (!entry.manual && !entry.final && month < fromMonth) {
      needed.set(key, { month, base, quote });
    }
  }

  const next: StoredMonthRates = { ...stored };
  const changes: Array<{
    month: string;
    base: string;
    quote: string;
    oldRate: number | null;
    newRate: number;
  }> = [];
  for (const { month, base, quote } of needed.values()) {
    const found = findMonthRate(stored, month, base, quote);
    if (found?.manual || found?.final) {
      continue;
    }
    const computed = await computeMonthRate(month, base, quote);
    if (!computed) {
      continue;
    }
    if (
      found &&
      isSameRate(found.rate, computed.rate) &&
      Boolean(found.final) === computed.final
    ) {
      continue;
    }
    const key = found?.inverted
      ? makeMonthRateId(month, quote, base)
      : makeMonthRateId(month, base, quote);
    const entry: StoredMonthRate = {
      rate: roundRate(found?.inverted ? 1 / computed.rate : computed.rate),
      ...(computed.final ? { final: true } : {}),
    };
    next[key] = entry;
    changes.push({
      month,
      base,
      quote,
      oldRate: found?.rate ?? null,
      newRate: computed.rate,
    });
  }
  if (changes.length === 0) {
    await ensureBudgetFactorRates();
    return { updated: 0 };
  }

  let updated = 0;
  await withMutatorContext({ undoListening: false }, () =>
    batchMessages(async () => {
      await writeMonthRates(next);
      for (const change of changes) {
        if (change.oldRate != null) {
          updated += await reconvert({
            context,
            accounts,
            budgets,
            ...change,
            oldRate: change.oldRate,
          });
        }
      }
    }),
  );
  await ensureBudgetFactorRates();
  return { updated };
}

/** Sets or clears (rate null) the rate a month converts at for a pair. */
export async function setMonthRate({
  month,
  base,
  quote,
  rate,
}: {
  month: string;
  base: string;
  quote: string;
  rate: number | null;
}): Promise<{ rate: number; manual: boolean; updated: number }> {
  if (!/^\d{4}-\d{2}$/.test(month) || base === quote) {
    throw new Error(`Invalid month rate: ${month} ${base}/${quote}`);
  }
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    throw new Error(`Invalid rate: ${rate}`);
  }
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    throw new Error('Multi-currency is not enabled');
  }
  const stored = await loadMonthRates();
  const found = findMonthRate(stored, month, base, quote);
  const next: StoredMonthRates = { ...stored };
  delete next[makeMonthRateId(month, base, quote)];
  delete next[makeMonthRateId(month, quote, base)];

  let newRate: number;
  if (rate === null) {
    const computed = await computeMonthRate(month, base, quote);
    if (!computed) {
      throw new Error(`No ${base} to ${quote} rate for ${month}`);
    }
    newRate = computed.rate;
    next[makeMonthRateId(month, base, quote)] = {
      rate: computed.rate,
      ...(computed.final ? { final: true } : {}),
    };
  } else {
    newRate = roundRate(rate);
    next[makeMonthRateId(month, base, quote)] = {
      rate: newRate,
      manual: true,
    };
  }

  const accounts = await loadAccountCurrencies(context.budgetCurrency);
  const budgets = await loadBudgetCurrencies();
  let updated = 0;
  await batchMessages(async () => {
    await writeMonthRates(next);
    if (found) {
      updated = await reconvert({
        context,
        accounts,
        budgets,
        month,
        base,
        quote,
        oldRate: found.rate,
        newRate,
      });
    }
  });
  applyBudgetFactors();
  return { rate: newRate, manual: rate !== null, updated };
}

export type MonthRateInfo = {
  /** 1 base = rate quote, quote being the default currency */
  base: string;
  quote: string;
  rate: number;
  manual: boolean;
  final: boolean;
};

/**
 * The rates a month converts at, for the budget page: every currency its
 * accounts and budgets use, to the default currency.
 */
export async function getMonthRates({
  month,
}: {
  month: string;
}): Promise<MonthRateInfo[]> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    return [];
  }
  const defaultCurrency = context.budgetCurrency;
  const accounts = await loadAccountCurrencies(defaultCurrency);
  const budgets = await loadBudgetCurrencies();
  const { start, end } = monthUtils.bounds(month);

  const currencies = new Set<string>();
  const rows = await db.all<{ account: string; category: string | null }>(
    `SELECT DISTINCT account, category FROM v_transactions_internal_alive
      WHERE date >= ? AND date <= ?`,
    [start, end],
  );
  for (const row of rows) {
    currencies.add(accounts.get(row.account) ?? defaultCurrency);
    if (row.category) {
      currencies.add(
        getBudgetCurrencyOf(context, budgets, row.category, month),
      );
    }
  }
  const budgetRows = await db.all<{ category: string }>(
    `SELECT category FROM ${getBudgetTable()} WHERE month = ?`,
    [parseInt(month.replace('-', ''))],
  );
  for (const row of budgetRows) {
    currencies.add(getBudgetCurrencyOf(context, budgets, row.category, month));
  }
  // Balances carried in from last month convert at this month's rate
  const prevMonth = monthUtils.prevMonth(month);
  for (const [key, currency] of budgets) {
    if (key.startsWith(`${prevMonth}:`)) {
      currencies.add(currency);
    }
  }
  currencies.delete(defaultCurrency);

  const lookup = createMonthRateLookup();
  const infos: MonthRateInfo[] = [];
  for (const base of [...currencies].sort()) {
    const found = await lookup.get(month, base, defaultCurrency);
    if (found) {
      infos.push({ base, quote: defaultCurrency, ...found });
    }
  }
  await lookup.flush();
  return infos;
}

// Spreadsheet

let factorCellsEnabled = false;

/**
 * Whether budget cells convert through the fork's factor cells. Decided
 * when the budget spreadsheet is built (multi-currency on), so a budget
 * file without it builds exactly the upstream cells.
 */
export function areBudgetFactorCellsEnabled(): boolean {
  return factorCellsEnabled;
}

export function setBudgetFactorCellsEnabled(): boolean {
  factorCellsEnabled = getMultiCurrencyContextSync().enabled;
  return factorCellsEnabled;
}

type FactorPair = { month: string; from: string; to: string };

/** The month rates the budget spreadsheet's conversion cells use. */
function collectFactorPairs(
  context: MultiCurrencyContext,
  budgets: BudgetCurrencies,
  categoryIds: string[],
  months: string[],
): FactorPair[] {
  const pairs = new Map<string, FactorPair>();
  const add = (month: string, from: string, to: string) => {
    if (from !== to) {
      pairs.set(makeMonthRateId(month, from, to), { month, from, to });
    }
  };
  for (const month of months) {
    const prevMonth = monthUtils.prevMonth(month);
    for (const id of categoryIds) {
      const currency = getBudgetCurrencyOf(context, budgets, id, month);
      add(month, currency, context.budgetCurrency);
      add(
        month,
        getBudgetCurrencyOf(context, budgets, id, prevMonth),
        currency,
      );
    }
  }
  return [...pairs.values()];
}

/**
 * Computes (and stores) any month rate the budget spreadsheet's conversion
 * cells need but doesn't have yet, then sets the cells.
 */
export async function ensureBudgetFactorRates(): Promise<void> {
  const spreadsheet = sheet.get();
  if (!spreadsheet || !factorCellsEnabled) {
    return;
  }
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    return;
  }
  const budgets = await loadBudgetCurrencies();
  const categories = await db.all<{ id: string }>(
    'SELECT id FROM categories WHERE tombstone = 0',
  );
  const pairs = collectFactorPairs(
    context,
    budgets,
    categories.map(row => row.id),
    [...(spreadsheet.meta().createdMonths ?? [])],
  );
  const lookup = createMonthRateLookup();
  for (const { month, from, to } of pairs) {
    await lookup.get(month, from, to);
  }
  await lookup.flush();
  applyBudgetFactors();
}

/**
 * Sets every created month's conversion cells: a category's figures to the
 * default currency, and its balance carried in from last month when the
 * budget's currency changed. Only cells whose value changes are written, so
 * this is cheap to call after any rate or currency change.
 */
export function applyBudgetFactors(months?: readonly string[]): void {
  const spreadsheet = sheet.get();
  if (!spreadsheet || !factorCellsEnabled) {
    return;
  }
  const context = getMultiCurrencyContextSync();
  if (!context.enabled) {
    return;
  }
  const defaultCurrency = context.budgetCurrency;
  const budgets = loadBudgetCurrenciesSync();
  const rates = loadMonthRatesSync();
  const categories = db.runQuery<{ id: string }>(
    'SELECT id FROM categories WHERE tombstone = 0',
    [],
    true,
  );
  const created: Iterable<string> =
    months ?? spreadsheet.meta().createdMonths ?? [];

  const factor = (month: string, from: string, to: string) => {
    if (from === to) {
      return 1;
    }
    const found = findMonthRate(rates, month, from, to);
    // Without a rate yet, nothing is converted; the refresh fills it in
    return found ? getCarryFactor(found.rate, from, to) : 1;
  };

  spreadsheet.startTransaction();
  try {
    for (const month of created) {
      const sheetName = monthUtils.sheetForMonth(month);
      const prevMonth = monthUtils.prevMonth(month);
      for (const { id } of categories) {
        const currency = getBudgetCurrencyOf(context, budgets, id, month);
        const previous = getBudgetCurrencyOf(context, budgets, id, prevMonth);
        const values: Array<[string, number]> = [
          [toDefaultCell(id), factor(month, currency, defaultCurrency)],
          [carryCell(id), factor(month, previous, currency)],
        ];
        for (const [cell, value] of values) {
          const current = spreadsheet.getCellValueLoose(sheetName, cell);
          if (current !== null && current !== value) {
            spreadsheet.set(`${sheetName}!${cell}`, value);
          }
        }
      }
    }
  } finally {
    spreadsheet.endTransaction();
  }
}

type ConvertedKind = 'sum-amount' | 'budget' | 'leftover';

/**
 * The cell group totals, To Budget and other cross-category figures read
 * for a category: its figure in the default currency when budgets can have
 * their own currency, otherwise upstream's cell.
 */
export function groupInputCell(
  kind: ConvertedKind,
  categoryId: string,
): string {
  return factorCellsEnabled
    ? `mc-d-${kind}-${categoryId}`
    : `${kind}-${categoryId}`;
}

const CONVERTED_KINDS: ConvertedKind[] = ['budget', 'sum-amount', 'leftover'];

/**
 * Each category's figures in a month in the default currency, for reports
 * (the budget month handlers add them): the converted cells that exist,
 * named and shaped like the handlers' other cells. Empty while budgets
 * can't have a currency of their own.
 */
export function getConvertedMonthCells(
  sheetName: string,
  categoryIds: readonly string[],
): Array<{ name: string; value: number }> {
  const spreadsheet = sheet.get();
  if (!spreadsheet || !factorCellsEnabled) {
    return [];
  }
  const cells: Array<{ name: string; value: number }> = [];
  for (const id of categoryIds) {
    for (const kind of CONVERTED_KINDS) {
      const cell = groupInputCell(kind, id);
      const value = spreadsheet.getCellValueLoose(sheetName, cell);
      if (value !== null) {
        cells.push({
          name: resolveName(sheetName, cell),
          value: typeof value === 'number' ? value : 0,
        });
      }
    }
  }
  return cells;
}

/**
 * The cell a report reads a category's figure from: in the default
 * currency when the month has one, otherwise upstream's cell.
 */
export function getReportCell(
  sheetName: string,
  kind: ConvertedKind,
  categoryId: string,
): string {
  const converted = groupInputCell(kind, categoryId);
  return factorCellsEnabled &&
    sheet.get()?.getCellValueLoose(sheetName, converted) != null
    ? converted
    : `${kind}-${categoryId}`;
}

/** Extra dependency of a balance carried in from last month. */
export function carryDependencies(categoryId: string): string[] {
  return factorCellsEnabled ? [carryCell(categoryId)] : [];
}

/** The conversion cells of a category; before its upstream cells. */
export function createBudgetFactorCells(
  categoryId: string,
  sheetName: string,
): void {
  if (!factorCellsEnabled) {
    return;
  }
  sheet.get().createStatic(sheetName, toDefaultCell(categoryId), 1);
  sheet.get().createStatic(sheetName, carryCell(categoryId), 1);
}

/** A blank month's starting values for what the next month reads. */
export function createBlankBudgetCells(
  categoryId: string,
  sheetName: string,
): void {
  if (!factorCellsEnabled) {
    return;
  }
  sheet
    .get()
    .createStatic(sheetName, groupInputCell('leftover', categoryId), 0);
}

/**
 * A category's figures in the default currency, for the cells that add
 * categories up; after its upstream cells.
 */
export function createConvertedBudgetCells(
  categoryId: string,
  sheetName: string,
  { hasBudget }: { hasBudget: boolean },
): void {
  if (!factorCellsEnabled) {
    return;
  }
  const kinds: ConvertedKind[] = hasBudget
    ? ['sum-amount', 'budget', 'leftover']
    : ['sum-amount'];
  for (const kind of kinds) {
    sheet.get().createDynamic(sheetName, groupInputCell(kind, categoryId), {
      initialValue: 0,
      dependencies: [`${kind}-${categoryId}`, toDefaultCell(categoryId)],
      run: convertByFactor,
    });
  }
}

/**
 * An amount multiplied by a conversion cell's value, rounded to whole minor
 * units. 1 (no conversion) leaves it as it is.
 */
export function convertByFactor(amount: unknown, factor: unknown): number {
  const value = typeof amount === 'number' ? amount : 0;
  const rate = typeof factor === 'number' ? factor : 1;
  if (rate === 1 || !Number.isFinite(rate)) {
    return value;
  }
  return roundHalfAwayFromZero(value * rate);
}
