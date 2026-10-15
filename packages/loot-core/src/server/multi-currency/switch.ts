// [fork:mc D-016] Changing the budget currency (for example CAD to EUR)
// while keeping the budget's history.
//
// Every account gets a currency for after the switch. Each transaction keeps
// its value in that currency (`mc_amount`, or `amount` when it is the new
// budget currency) and gets a new budget amount at its own date's rate.
// Accounts recorded with the docs workaround take their amounts from the
// notes. Budgets, goals and held amounts are converted at each month's
// average rate, except the part of a budget its category spent, which takes
// the rate of that spending; rule and schedule amounts at today's rate.
// Rules written for the workaround would convert amounts a second time, so
// they are deleted.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { resetFormulaPreferencesCache } from '#server/formulas/bootstrap';
import { batchMessages } from '#server/sync';
import {
  deleteRule,
  ruleModel,
  updateRule,
} from '#server/transactions/transaction-rules';
import { getCurrency, getDecimalPlaces } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import {
  convertMinorUnits,
  isCurrencyCode,
  roundHalfAwayFromZero,
} from '#shared/multi-currency';

import { getWorkaroundNoteCurrency, parseWorkaroundNote } from './accounts';
import { getMultiCurrencyContext, getRatesAt } from './rates';

type AccountRow = {
  id: string;
  name: string;
  mc_currency: string | null;
  offbudget: 0 | 1;
  closed: 0 | 1;
  tombstone: 0 | 1;
};

type TransactionRow = {
  id: string;
  account: string;
  amount: number;
  mc_amount: number | null;
  date: number;
  notes: string | null;
  category: string | null;
  transfer_id: string | null;
  is_parent: 0 | 1;
  is_child: 0 | 1;
  parent_id: string | null;
};

type BudgetRow = {
  id: string;
  month: number;
  category: string;
  amount: number | null;
  goal: number | null;
};

type RuleJS = {
  id: string;
  stage: string | null;
  conditionsOp: string;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
};

/** A transaction after the switch */
type NewValue = {
  /** In the account's new currency */
  value: number;
  /** In the new budget currency */
  amount: number;
  /** The value was read from a workaround note */
  isFromNote: boolean;
};

export type SwitchSuggestionReason =
  | 'current'
  | 'account-note'
  | 'account-name'
  | 'transaction-notes';

export type SwitchAccountPreview = {
  id: string;
  name: string;
  closed: boolean;
  offbudget: boolean;
  /** The account's currency now */
  currency: string;
  /** Suggested currency after the switch, and why */
  suggested: string;
  reason: SwitchSuggestionReason;
  /** Transactions, counting a split once */
  transactions: number;
  /** Transactions whose notes carry an amount in the suggested currency */
  notedTransactions: number;
};

export type SwitchPreview = {
  fromCurrency: string;
  toCurrency: string;
  /** What 1 unit of the current budget currency is worth today */
  todayRate: number | null;
  accounts: SwitchAccountPreview[];
  /** Transactions, counting a split once */
  transactions: number;
  firstDate: string | null;
  budgetMonths: number;
  /** Rules (and schedules) with amounts, converted at today's rate */
  rulesWithAmounts: number;
  /** Rules written for the docs workaround; deleted by the switch */
  workaroundRules: Array<{ id: string; accounts: string[] }>;
};

export type SwitchResult = {
  transactions: number;
  budgets: number;
  rules: number;
  deletedRules: number;
};

const TRANSACTION_FIELDS =
  'id, account, amount, mc_amount, date, notes, category, transfer_id, is_parent, is_child, parent_id';

const ACCOUNT_NOTE_CURRENCY = /#currency:([A-Z]{3})\b/;
const ACCOUNT_NAME_CURRENCY = /\(([A-Z]{3})\)\s*$/;

function isSupportedCurrency(code: string | null | undefined): code is string {
  return isCurrencyCode(code) && getCurrency(code).code === code;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Moves whatever `values` miss of `total` onto the largest one. */
function balance(values: number[], total: number): number[] {
  const difference = total - sum(values);
  if (difference === 0 || values.length === 0) {
    return values;
  }
  const largest = values.reduce(
    (top, value, index) =>
      Math.abs(value) > Math.abs(values[top]) ? index : top,
    0,
  );
  return values.map((value, index) =>
    index === largest ? value + difference : value,
  );
}

/** Splits `total` in proportion to `weights`, whose sum must not be 0. */
function allocate(total: number, weights: number[]): number[] {
  const weightSum = sum(weights);
  return balance(
    weights.map(weight => roundHalfAwayFromZero((total * weight) / weightSum)),
    total,
  );
}

async function loadAccounts(): Promise<AccountRow[]> {
  return db.all<AccountRow>(
    `SELECT id, name, mc_currency, offbudget, closed, tombstone FROM accounts
      ORDER BY closed, offbudget, sort_order, name`,
  );
}

async function loadTransactions(): Promise<TransactionRow[]> {
  return db.all<TransactionRow>(
    `SELECT ${TRANSACTION_FIELDS} FROM v_transactions_internal_alive`,
  );
}

async function loadRules(): Promise<RuleJS[]> {
  const rows = await db.all<db.DbRule>(
    `SELECT * FROM rules
      WHERE tombstone = 0 AND conditions IS NOT NULL AND actions IS NOT NULL`,
  );
  return rows.map(row => ruleModel.toJS(row) as RuleJS);
}

async function loadAccountNotes(): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; note: string | null }>(
    "SELECT id, note FROM notes WHERE id LIKE 'account-%'",
  );
  return new Map(
    rows.map(row => [row.id.slice('account-'.length), row.note ?? '']),
  );
}

function isWorkaroundRule(rule: RuleJS): boolean {
  const templateOf = (action: Record<string, unknown>) =>
    (action.options as { template?: string } | undefined)?.template ?? '';
  const setsNotes = rule.actions.some(
    action =>
      action.op === 'set' &&
      action.field === 'notes' &&
      /FX rate:/.test(templateOf(action)),
  );
  const setsAmount = rule.actions.some(
    action =>
      action.op === 'set' &&
      action.field === 'amount' &&
      templateOf(action) !== '',
  );
  return setsNotes && setsAmount;
}

function ruleAccounts(rule: RuleJS): string[] {
  return rule.conditions
    .filter(condition => condition.field === 'account')
    .flatMap(condition =>
      Array.isArray(condition.value)
        ? (condition.value as string[])
        : [condition.value as string],
    );
}

/** Converts every amount a rule compares or sets; false if it has none. */
function convertRuleAmounts(
  rule: RuleJS,
  convert: (amount: number) => number,
): boolean {
  let changed = false;
  const convertValue = (value: unknown): unknown => {
    if (typeof value === 'number') {
      changed = true;
      return convert(value);
    }
    if (
      value &&
      typeof value === 'object' &&
      'num1' in value &&
      'num2' in value
    ) {
      const range = value as { num1: unknown; num2: unknown };
      if (typeof range.num1 === 'number' && typeof range.num2 === 'number') {
        changed = true;
        return { num1: convert(range.num1), num2: convert(range.num2) };
      }
    }
    return value;
  };

  rule.conditions = rule.conditions.map(condition =>
    condition.field === 'amount'
      ? { ...condition, value: convertValue(condition.value) }
      : condition,
  );
  rule.actions = rule.actions.map(action => {
    const options = action.options as
      | { template?: string; formula?: string; method?: string }
      | undefined;
    if (
      action.op === 'set' &&
      action.field === 'amount' &&
      !options?.template &&
      !options?.formula
    ) {
      return { ...action, value: convertValue(action.value) };
    }
    if (
      action.op === 'set-split-amount' &&
      options?.method === 'fixed-amount'
    ) {
      return { ...action, value: convertValue(action.value) };
    }
    return action;
  });
  return changed;
}

/**
 * The currency an account most likely holds: its own currency, then the
 * docs' `#currency:XXX` account note, an "(XXX)" name suffix, or workaround
 * notes on at least half of its transactions.
 */
function suggestCurrency(
  account: AccountRow,
  fromCurrency: string,
  accountNote: string | null,
  transactions: TransactionRow[],
): { suggested: string; reason: SwitchSuggestionReason; noted: number } {
  const countNoted = (code: string) =>
    transactions.filter(row => getWorkaroundNoteCurrency(row.notes) === code)
      .length;
  if (account.mc_currency) {
    return { suggested: account.mc_currency, reason: 'current', noted: 0 };
  }

  const fromNote = accountNote?.match(ACCOUNT_NOTE_CURRENCY)?.[1];
  if (isSupportedCurrency(fromNote)) {
    return {
      suggested: fromNote,
      reason: 'account-note',
      noted: countNoted(fromNote),
    };
  }
  const fromName = account.name.match(ACCOUNT_NAME_CURRENCY)?.[1];
  if (isSupportedCurrency(fromName)) {
    return {
      suggested: fromName,
      reason: 'account-name',
      noted: countNoted(fromName),
    };
  }

  const byCurrency = new Map<string, number>();
  for (const row of transactions) {
    const code = getWorkaroundNoteCurrency(row.notes);
    if (code !== fromCurrency && isSupportedCurrency(code)) {
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let noted = 0;
  for (const [code, count] of byCurrency) {
    if (count > noted) {
      best = code;
      noted = count;
    }
  }
  const withAmounts = transactions.filter(row => row.amount !== 0).length;
  if (best && noted * 2 >= withAmounts) {
    return { suggested: best, reason: 'transaction-notes', noted };
  }
  return { suggested: fromCurrency, reason: 'current', noted: 0 };
}

async function getContext(toCurrency: string) {
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    throw APIError('Multi-currency is not enabled');
  }
  if (!isSupportedCurrency(toCurrency)) {
    throw APIError(`Invalid currency: ${JSON.stringify(toCurrency)}`);
  }
  if (toCurrency === budgetCurrency) {
    throw APIError(`The budget is already in ${toCurrency}`);
  }
  return { fromCurrency: budgetCurrency };
}

function groupByAccount(transactions: TransactionRow[]) {
  const byAccount = new Map<string, TransactionRow[]>();
  for (const row of transactions) {
    const list = byAccount.get(row.account) ?? [];
    list.push(row);
    byAccount.set(row.account, list);
  }
  return byAccount;
}

export async function previewCurrencySwitch({
  toCurrency,
}: {
  toCurrency: string;
}): Promise<SwitchPreview> {
  const { fromCurrency } = await getContext(toCurrency);
  const [accounts, transactions, rules, accountNotes, budgetMonths] =
    await Promise.all([
      loadAccounts(),
      loadTransactions(),
      loadRules(),
      loadAccountNotes(),
      db.all<{ month: number }>(
        'SELECT month FROM zero_budgets UNION SELECT month FROM reflect_budgets',
      ),
    ]);
  const today = monthUtils.currentDay();
  const todayRate =
    (await getRatesAt(fromCurrency, toCurrency, [today]))[today] ?? null;

  const counted = transactions.filter(row => !row.is_child);
  const byAccount = groupByAccount(counted);
  const accountNames = new Map(accounts.map(row => [row.id, row.name]));
  const first = counted.reduce<number | null>(
    (min, row) => (min === null || row.date < min ? row.date : min),
    null,
  );

  return {
    fromCurrency,
    toCurrency,
    todayRate,
    accounts: accounts
      .filter(account => !account.tombstone)
      .map(account => {
        const rows = byAccount.get(account.id) ?? [];
        const { suggested, reason, noted } = suggestCurrency(
          account,
          fromCurrency,
          accountNotes.get(account.id) ?? null,
          rows,
        );
        return {
          id: account.id,
          name: account.name,
          closed: account.closed === 1,
          offbudget: account.offbudget === 1,
          currency: account.mc_currency || fromCurrency,
          suggested,
          reason,
          transactions: rows.length,
          notedTransactions: noted,
        };
      }),
    transactions: counted.length,
    firstDate: first === null ? null : db.fromDateRepr(first),
    budgetMonths: new Set(budgetMonths.map(row => row.month)).size,
    rulesWithAmounts: rules.filter(
      rule => !isWorkaroundRule(rule) && convertRuleAmounts(rule, x => x),
    ).length,
    workaroundRules: rules.filter(isWorkaroundRule).map(rule => ({
      id: rule.id,
      accounts: ruleAccounts(rule).map(id => accountNames.get(id) ?? id),
    })),
  };
}

function monthOf(month: number): string {
  const text = String(month);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

/** The days of a month that have happened, up to today. */
function daysOfMonth(month: string, today: string): string[] {
  const first = `${month}-01`;
  if (first > today) {
    return [];
  }
  const last = monthUtils.lastDayOfMonth(first);
  return monthUtils.dayRangeInclusive(first, last > today ? today : last);
}

/**
 * Converts the budget's history to `toCurrency`. `accountCurrencies` gives
 * each account's currency after the switch; accounts left out keep theirs.
 */
export async function switchBudgetCurrency({
  toCurrency,
  accountCurrencies,
}: {
  toCurrency: string;
  accountCurrencies: Record<string, string>;
}): Promise<SwitchResult> {
  const { fromCurrency } = await getContext(toCurrency);
  for (const code of Object.values(accountCurrencies)) {
    if (!isSupportedCurrency(code)) {
      throw APIError(`Invalid currency: ${JSON.stringify(code)}`);
    }
  }

  const [
    accounts,
    transactions,
    rules,
    zeroBudgets,
    reflectBudgets,
    held,
    reportCurrency,
    incomeCategories,
  ] = await Promise.all([
    loadAccounts(),
    loadTransactions(),
    loadRules(),
    db.all<BudgetRow>(
      'SELECT id, month, category, amount, goal FROM zero_budgets',
    ),
    db.all<BudgetRow>(
      'SELECT id, month, category, amount, goal FROM reflect_budgets',
    ),
    db.all<{ id: string; buffered: number | null }>(
      'SELECT id, buffered FROM zero_budget_months',
    ),
    db.first<{ value: string | null }>(
      "SELECT value FROM preferences WHERE id = 'mcReportCurrency'",
    ),
    db.all<{ id: string }>('SELECT id FROM categories WHERE is_income = 1'),
  ]);

  const oldCurrency = new Map(
    accounts.map(row => [row.id, row.mc_currency || fromCurrency]),
  );
  const newCurrency = new Map(
    accounts.map(row => [
      row.id,
      accountCurrencies[row.id] ?? (row.mc_currency || fromCurrency),
    ]),
  );
  const before = (accountId: string) =>
    oldCurrency.get(accountId) ?? fromCurrency;
  const after = (accountId: string) =>
    newCurrency.get(accountId) ?? before(accountId);
  const dateOf = (row: TransactionRow) => db.fromDateRepr(row.date);
  const today = monthUtils.currentDay();

  // The rates needed, by currency pair
  const pairDates = new Map<string, Set<string>>();
  const need = (from: string, to: string, date: string) => {
    if (from !== to) {
      const key = `${from}:${to}`;
      pairDates.set(key, (pairDates.get(key) ?? new Set()).add(date));
    }
  };
  for (const row of transactions) {
    const date = dateOf(row);
    const was = before(row.account);
    const will = after(row.account);
    if (was !== fromCurrency && row.mc_amount == null) {
      need(fromCurrency, was, date);
    }
    if (
      will !== was &&
      (row.is_child || parseWorkaroundNote(row.notes, will) === null)
    ) {
      need(was, will, date);
    }
    need(will, toCurrency, date);
  }
  const budgetMonths = [
    ...new Set(
      [...zeroBudgets, ...reflectBudgets]
        .map(row => monthOf(row.month))
        .concat(held.map(row => row.id)),
    ),
  ];
  need(fromCurrency, toCurrency, today);
  for (const month of budgetMonths) {
    for (const day of daysOfMonth(month, today)) {
      need(fromCurrency, toCurrency, day);
    }
  }

  const rates = new Map<string, Record<string, number | null>>();
  for (const [key, dates] of pairDates) {
    const [from, to] = key.split(':');
    const found = await getRatesAt(from, to, [...dates]);
    if (Object.values(found).some(rate => rate == null)) {
      throw APIError(
        `No exchange rate from ${from} to ${to} is available. Turn on automatic rate downloads or add a rate first.`,
      );
    }
    rates.set(key, found);
  }
  const convert = (amount: number, from: string, to: string, date: string) => {
    if (from === to) {
      return amount;
    }
    const rate = rates.get(`${from}:${to}`)?.[date];
    if (rate == null) {
      throw new Error(`No ${from} to ${to} rate for ${date}`);
    }
    return convertMinorUnits(amount, rate, from, to);
  };
  // A transaction's value in its account's current currency
  const storedValue = (row: TransactionRow) => {
    const was = before(row.account);
    if (was === fromCurrency) {
      return row.amount;
    }
    return row.mc_amount ?? convert(row.amount, fromCurrency, was, dateOf(row));
  };

  // Transactions and split parents: the value in the account's new
  // currency, then in the new budget currency
  const values = new Map<string, NewValue>();
  const byId = new Map(transactions.map(row => [row.id, row]));
  for (const row of transactions.filter(row => !row.is_child)) {
    const date = dateOf(row);
    const was = before(row.account);
    const will = after(row.account);
    const stored = storedValue(row);
    const noted = will !== was ? parseWorkaroundNote(row.notes, will) : null;
    const value =
      will === was ? stored : (noted ?? convert(stored, was, will, date));
    values.set(row.id, {
      value,
      amount: convert(value, will, toCurrency, date),
      isFromNote: noted !== null,
    });
  }

  // Split children share their parent's value in proportion
  const childrenOf = new Map<string, TransactionRow[]>();
  for (const row of transactions) {
    if (row.is_child && row.parent_id) {
      const list = childrenOf.get(row.parent_id) ?? [];
      list.push(row);
      childrenOf.set(row.parent_id, list);
    }
  }
  for (const [parentId, children] of childrenOf) {
    const parentRow = byId.get(parentId);
    const parent = values.get(parentId);
    if (!parentRow || !parent) {
      continue;
    }
    const date = dateOf(parentRow);
    const was = before(parentRow.account);
    const will = after(parentRow.account);
    const stored = children.map(storedValue);
    let childValues: number[];
    if (will === was) {
      childValues = stored;
    } else if (sum(stored) !== 0) {
      childValues = allocate(parent.value, stored);
    } else {
      childValues = balance(
        stored.map(value => convert(value, was, will, date)),
        parent.value,
      );
    }
    children.forEach((child, index) => {
      values.set(child.id, {
        value: childValues[index],
        amount: convert(childValues[index], will, toCurrency, date),
        isFromNote: parent.isFromNote,
      });
    });
  }

  // Transfers mirror each other. The side that decides: one in the new
  // budget currency, then one read from a workaround note, then the paying
  // side.
  const rank = (row: TransactionRow, value: NewValue) => [
    after(row.account) === toCurrency ? 1 : 0,
    value.isFromNote ? 1 : 0,
    value.amount < 0 ? 1 : 0,
  ];
  for (const row of transactions) {
    const partner = row.transfer_id ? byId.get(row.transfer_id) : undefined;
    if (!partner || row.id > partner.id || row.is_parent || partner.is_parent) {
      continue;
    }
    const mine = values.get(row.id);
    const theirs = values.get(partner.id);
    if (!mine || !theirs || mine.amount === -theirs.amount) {
      continue;
    }
    const myRank = rank(row, mine);
    const theirRank = rank(partner, theirs);
    const difference = myRank.findIndex(
      (value, index) => value !== theirRank[index],
    );
    const rowDecides =
      difference === -1 || myRank[difference] > theirRank[difference];
    if (rowDecides) {
      theirs.amount = -mine.amount;
    } else {
      mine.amount = -theirs.amount;
    }
  }

  // A split's budget amount is the sum of its children's
  for (const [parentId, children] of childrenOf) {
    const parent = values.get(parentId);
    if (parent) {
      parent.amount = sum(
        children.map(child => values.get(child.id)?.amount ?? 0),
      );
    }
  }

  // What each category spent (or received) per month, before and after, as
  // the budget sums it: on-budget accounts only
  const isOnBudget = new Map(
    accounts.map(row => [row.id, row.offbudget === 0]),
  );
  const spending = new Map<string, { before: number; after: number }>();
  for (const row of transactions) {
    const next = values.get(row.id);
    if (row.category && next && isOnBudget.get(row.account)) {
      const key = `${Math.floor(row.date / 100)}-${row.category}`;
      const sums = spending.get(key) ?? { before: 0, after: 0 };
      sums.before += row.amount;
      sums.after += next.amount;
      spending.set(key, sums);
    }
  }
  const isIncome = new Set(incomeCategories.map(row => row.id));

  // Budgets, goals and held money at each month's average rate
  const budgetRates = rates.get(`${fromCurrency}:${toCurrency}`) ?? {};
  const monthRate = new Map<string, number>();
  for (const month of budgetMonths) {
    const found = daysOfMonth(month, today)
      .map(day => budgetRates[day])
      .filter((rate): rate is number => rate != null);
    monthRate.set(
      month,
      found.length > 0
        ? sum(found) / found.length
        : (budgetRates[today] as number),
    );
  }
  const atMonth = (amount: number | null, month: string) =>
    amount == null || amount === 0
      ? amount
      : convertMinorUnits(
          amount,
          monthRate.get(month) as number,
          fromCurrency,
          toCurrency,
        );

  // The part of a budget its category used (spent, or received for income)
  // takes the rate of those transactions instead, so a budget that was
  // exactly used still is. Far-off rates (refunds netting out a purchase)
  // fall back to the month's average.
  const minorUnits =
    10 ** (getDecimalPlaces(toCurrency) - getDecimalPlaces(fromCurrency));
  const convertBudget = (row: BudgetRow) => {
    const month = monthOf(row.month);
    const sums = spending.get(`${row.month}-${row.category}`);
    if (!row.amount || row.amount < 0 || !sums) {
      return atMonth(row.amount, month);
    }
    const sign = isIncome.has(row.category) ? 1 : -1;
    const used = sign * sums.before;
    const part = Math.min(Math.max(used, 0), row.amount);
    const average = (monthRate.get(month) as number) * minorUnits;
    const usedRate = part > 0 ? sums.after / sums.before : 0;
    if (part === 0 || Math.abs(usedRate / average - 1) > 0.1) {
      return atMonth(row.amount, month);
    }
    return roundHalfAwayFromZero(
      part * usedRate + (row.amount - part) * average,
    );
  };

  // Rule and schedule amounts at today's rate
  const todayRate = budgetRates[today] as number;
  const convertedRules: RuleJS[] = [];
  const workaroundRules: RuleJS[] = [];
  for (const rule of rules) {
    if (isWorkaroundRule(rule)) {
      workaroundRules.push(rule);
    } else if (
      convertRuleAmounts(rule, amount =>
        convertMinorUnits(amount, todayRate, fromCurrency, toCurrency),
      )
    ) {
      convertedRules.push(rule);
    }
  }

  // The new currency's formats, as choosing it in the currency settings does
  const currency = getCurrency(toCurrency);
  const prefs: Record<string, string> = {
    defaultCurrencyCode: toCurrency,
    numberFormat: currency.numberFormat,
    hideFraction: currency.decimalPlaces === 0 ? 'true' : 'false',
    currencySymbolPosition: currency.symbolFirst ? 'before' : 'after',
    currencySpaceBetweenAmountAndSymbol: currency.symbolFirst
      ? 'false'
      : 'true',
  };
  if (reportCurrency?.value === toCurrency) {
    prefs.mcReportCurrency = '';
  }

  let updatedTransactions = 0;
  let updatedBudgets = 0;
  let deletedRules = 0;
  await batchMessages(async () => {
    for (const account of accounts) {
      const will = after(account.id);
      const mcCurrency = will === toCurrency ? null : will;
      if (mcCurrency !== account.mc_currency) {
        await db.update('accounts', {
          id: account.id,
          mc_currency: mcCurrency,
        });
      }
    }
    for (const row of transactions) {
      const next = values.get(row.id);
      if (!next) {
        continue;
      }
      const mcAmount = after(row.account) === toCurrency ? null : next.value;
      if (next.amount !== row.amount || mcAmount !== row.mc_amount) {
        await db.updateTransaction({
          id: row.id,
          amount: next.amount,
          mc_amount: mcAmount,
        });
        // Counted like the preview: a split once
        if (!row.is_child) {
          updatedTransactions++;
        }
      }
    }
    for (const [table, rows] of [
      ['zero_budgets', zeroBudgets],
      ['reflect_budgets', reflectBudgets],
    ] as const) {
      for (const row of rows) {
        if (!row.amount && !row.goal) {
          continue;
        }
        await db.update(table, {
          id: row.id,
          amount: convertBudget(row),
          goal: atMonth(row.goal, monthOf(row.month)),
        });
        updatedBudgets++;
      }
    }
    for (const row of held) {
      if (row.buffered) {
        await db.update('zero_budget_months', {
          id: row.id,
          buffered: atMonth(row.buffered, row.id),
        });
      }
    }
    for (const rule of convertedRules) {
      await updateRule({
        id: rule.id,
        conditions: rule.conditions,
        actions: rule.actions,
      });
    }
    for (const rule of workaroundRules) {
      if (await deleteRule(rule.id)) {
        deletedRules++;
      }
    }
    for (const [id, value] of Object.entries(prefs)) {
      await db.update('preferences', { id, value });
    }
  });
  resetFormulaPreferencesCache();

  return {
    transactions: updatedTransactions,
    budgets: updatedBudgets,
    rules: convertedRules.length,
    deletedRules,
  };
}
