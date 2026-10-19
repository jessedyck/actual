// [fork:mc D-017] Changing the default currency of a budget file (for
// example CAD to EUR) without changing past budgets.
//
// Only what uses the default currency follows it: accounts and budgets with
// a currency of their own keep it. The change can keep budgets without a
// currency in the old one up to the current month (`mcCurrencyPeriods`),
// and can give accounts without one a currency first: the old one, or
// another such as EUR for an account recorded with the docs workaround,
// whose amounts are then read from its notes. Every transaction's `amount`
// becomes its value in the new default currency at the rate of its month;
// values counted in a budget of another currency (`mc_budget_amount`) keep
// what the budget counted, so past months show what they showed before.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { resetFormulaPreferencesCache } from '#server/formulas/bootstrap';
import { batchMessages } from '#server/sync';
import {
  deleteRule,
  ruleModel,
  updateRule,
} from '#server/transactions/transaction-rules';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import {
  convertMinorUnits,
  getBudgetCurrencyAt,
  hundredthsToMinorUnits,
  MC_PREF_CURRENCY_PERIODS,
  minorUnitsToHundredths,
  roundHalfAwayFromZero,
} from '#shared/multi-currency';
import type { CurrencyPeriod } from '#shared/multi-currency';

import { getWorkaroundNoteCurrency, parseWorkaroundNote } from './accounts';
import { isSupportedCurrency } from './budget-currency';
import {
  createMonthRateLookup,
  ensureBudgetFactorRates,
  getBudgetTable,
  loadBudgetCurrencies,
} from './month-rates';
import { ensureRates, getMultiCurrencyContext, getRatesAt } from './rates';

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
  category: string | null;
  amount: number;
  mc_amount: number | null;
  mc_budget_amount: number | null;
  date: number;
  notes: string | null;
  transfer_id: string | null;
  is_parent: 0 | 1;
  is_child: 0 | 1;
  parent_id: string | null;
};

type RuleJS = {
  id: string;
  stage: string | null;
  conditionsOp: string;
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
};

export type SuggestionReason =
  | 'current'
  | 'account-note'
  | 'account-name'
  | 'transaction-notes';

export type DefaultCurrencyAccount = {
  id: string;
  name: string;
  closed: boolean;
  offbudget: boolean;
  /** The account's own currency, null when it uses the default one */
  currency: string | null;
  /** For an account without one: the currency it most likely holds */
  suggested: string;
  reason: SuggestionReason;
  /** Transactions, counting a split once */
  transactions: number;
  /** Transactions whose notes carry an amount in the suggested currency */
  notedTransactions: number;
};

export type DefaultCurrencyPreview = {
  fromCurrency: string;
  toCurrency: string;
  /** What 1 unit of the current default currency is worth today */
  todayRate: number | null;
  accounts: DefaultCurrencyAccount[];
  /** Budgets without a currency of their own, up to `keepUntil` */
  unsetBudgets: number;
  /** The last month budgets without a currency can keep the old one for */
  keepUntil: string;
  /**
   * Rules written for the docs workaround. One goes when every account it
   * applies to ends up in another currency than the old default.
   */
  workaroundRules: Array<{
    id: string;
    accountIds: string[];
    accounts: string[];
  }>;
};

export type DefaultCurrencyResult = {
  accounts: number;
  transactions: number;
  rules: number;
  deletedRules: number;
};

const TRANSACTION_FIELDS =
  'id, account, category, amount, mc_amount, mc_budget_amount, date, notes, transfer_id, is_parent, is_child, parent_id';

const ACCOUNT_NOTE_CURRENCY = /#currency:([A-Z]{3})\b/;
const ACCOUNT_NAME_CURRENCY = /\(([A-Z]{3})\)\s*$/;

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
): { suggested: string; reason: SuggestionReason; noted: number } {
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
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    throw APIError('Multi-currency is not enabled');
  }
  if (!isSupportedCurrency(toCurrency)) {
    throw APIError(`Invalid currency: ${JSON.stringify(toCurrency)}`);
  }
  if (toCurrency === context.budgetCurrency) {
    throw APIError(`The default currency is already ${toCurrency}`);
  }
  return context;
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

export async function previewDefaultCurrency({
  toCurrency,
}: {
  toCurrency: string;
}): Promise<DefaultCurrencyPreview> {
  const context = await getContext(toCurrency);
  const fromCurrency = context.budgetCurrency;
  const keepUntil = monthUtils.currentMonth();
  const [accounts, transactions, rules, accountNotes, budgetRows] =
    await Promise.all([
      loadAccounts(),
      loadTransactions(),
      loadRules(),
      loadAccountNotes(),
      db.all<{ month: number }>(
        `SELECT month FROM ${getBudgetTable()}
          WHERE mc_currency IS NULL AND month <= ?`,
        [parseInt(keepUntil.replace('-', ''))],
      ),
    ]);
  const today = monthUtils.currentDay();
  const todayRate =
    (await getRatesAt(fromCurrency, toCurrency, [today]))[today] ?? null;

  const counted = transactions.filter(row => !row.is_child);
  const byAccount = groupByAccount(counted);
  const accountNames = new Map(accounts.map(row => [row.id, row.name]));

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
          currency: account.mc_currency,
          suggested,
          reason,
          transactions: rows.length,
          notedTransactions: noted,
        };
      }),
    unsetBudgets: budgetRows.length,
    keepUntil,
    workaroundRules: rules.filter(isWorkaroundRule).map(rule => ({
      id: rule.id,
      accountIds: ruleAccounts(rule),
      accounts: ruleAccounts(rule).map(id => accountNames.get(id) ?? id),
    })),
  };
}

/** Value and budget values of a transaction after the change */
type NewValue = {
  /** In the account's currency afterwards */
  value: number;
  /** In the new default currency */
  amount: number;
  isFromNote: boolean;
};

/**
 * Changes the default currency to `toCurrency`. `accountCurrencies` gives
 * accounts a currency first (an account without one that is left out
 * follows the new default, keeping its numbers); with `keepBudgets`,
 * budgets without a currency keep the old one up to the current month.
 */
export async function setDefaultCurrency({
  toCurrency,
  accountCurrencies,
  keepBudgets,
}: {
  toCurrency: string;
  accountCurrencies: Record<string, string>;
  keepBudgets: boolean;
}): Promise<DefaultCurrencyResult> {
  const context = await getContext(toCurrency);
  const fromCurrency = context.budgetCurrency;
  for (const code of Object.values(accountCurrencies)) {
    if (!isSupportedCurrency(code)) {
      throw APIError(`Invalid currency: ${JSON.stringify(code)}`);
    }
  }

  const [accounts, transactions, rules, reportCurrency] = await Promise.all([
    loadAccounts(),
    loadTransactions(),
    loadRules(),
    db.first<{ value: string | null }>(
      "SELECT value FROM preferences WHERE id = 'mcReportCurrency'",
    ),
  ]);
  const budgets = await loadBudgetCurrencies();

  const keepUntil = monthUtils.currentMonth();
  const lastPeriod = context.periods[context.periods.length - 1];
  const periods: CurrencyPeriod[] =
    keepBudgets && !(lastPeriod && lastPeriod.until >= keepUntil)
      ? [...context.periods, { currency: fromCurrency, until: keepUntil }]
      : context.periods;
  const budgetCurrencyBefore = (category: string, month: string) =>
    budgets.get(`${month}:${category}`) ??
    getBudgetCurrencyAt(month, context.periods, fromCurrency);
  const budgetCurrencyAfter = (category: string, month: string) =>
    budgets.get(`${month}:${category}`) ??
    getBudgetCurrencyAt(month, periods, toCurrency);

  const accountById = new Map(accounts.map(row => [row.id, row]));
  const before = (accountId: string) =>
    accountById.get(accountId)?.mc_currency || fromCurrency;
  const after = (accountId: string) =>
    accountCurrencies[accountId] ??
    (accountById.get(accountId)?.mc_currency || toCurrency);
  // An account without a currency that wasn't given one keeps its numbers
  const followsDefault = (accountId: string) =>
    !accountById.get(accountId)?.mc_currency &&
    accountCurrencies[accountId] === undefined;
  const isOffBudget = (accountId: string) =>
    accountById.get(accountId)?.offbudget === 1;
  const dateOf = (row: TransactionRow) => db.fromDateRepr(row.date);

  // Fetch each pair's rates as one range before converting month by month
  const firstDate = transactions.reduce<number | null>(
    (min, row) => (min === null || row.date < min ? row.date : min),
    null,
  );
  if (firstDate !== null) {
    const firstMonth = monthUtils.monthFromDate(db.fromDateRepr(firstDate));
    const monthStarts = monthUtils
      .rangeInclusive(firstMonth, monthUtils.currentMonth())
      .map(month => `${month}-01`);
    const currencies = new Set([
      fromCurrency,
      ...accounts.map(row => after(row.id)),
      ...budgets.values(),
    ]);
    for (const currency of currencies) {
      if (currency !== toCurrency) {
        await ensureRates(currency, toCurrency, monthStarts);
      }
    }
  }
  const lookup = createMonthRateLookup();
  const convert = async (
    amount: number,
    from: string,
    to: string,
    date: string,
  ) => {
    if (from === to) {
      return amount;
    }
    const converted = await lookup.convert(amount, date, from, to);
    if (converted == null) {
      throw APIError(
        `No exchange rate from ${from} to ${to} is available. Turn on automatic rate downloads or add a rate first.`,
      );
    }
    return converted;
  };
  // A transaction's value in its account's current currency
  const storedValue = (row: TransactionRow) =>
    before(row.account) === fromCurrency ? row.amount : row.mc_amount;

  // Transactions and split parents: the value in the account's currency
  // afterwards, then in the new default currency
  const values = new Map<string, NewValue>();
  const byId = new Map(transactions.map(row => [row.id, row]));
  for (const row of transactions.filter(row => !row.is_child)) {
    const date = dateOf(row);
    const was = before(row.account);
    const will = after(row.account);
    const stored =
      storedValue(row) ?? (await convert(row.amount, fromCurrency, was, date));
    const noted =
      will !== was && !followsDefault(row.account)
        ? parseWorkaroundNote(row.notes, will)
        : null;
    const value =
      will === was || followsDefault(row.account)
        ? stored
        : (noted ?? (await convert(stored, was, will, date)));
    values.set(row.id, {
      value,
      amount: await convert(value, will, toCurrency, date),
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
    const stored = await Promise.all(
      children.map(
        async child =>
          storedValue(child) ??
          (await convert(child.amount, fromCurrency, was, date)),
      ),
    );
    let childValues: number[];
    if (will === was || followsDefault(parentRow.account)) {
      childValues = stored;
    } else if (sum(stored) !== 0) {
      childValues = allocate(parent.value, stored);
    } else {
      childValues = balance(
        await Promise.all(stored.map(value => convert(value, was, will, date))),
        parent.value,
      );
    }
    for (const [index, child] of children.entries()) {
      values.set(child.id, {
        value: childValues[index],
        amount: await convert(childValues[index], will, toCurrency, date),
        isFromNote: parent.isFromNote,
      });
    }
  }

  // Transfers mirror each other. The side that decides: one in the new
  // default currency, then one read from a workaround note, then the
  // paying side.
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

  // A split's amount is the sum of its children's
  for (const [parentId, children] of childrenOf) {
    const parent = values.get(parentId);
    if (parent) {
      parent.amount = sum(
        children.map(child => values.get(child.id)?.amount ?? 0),
      );
    }
  }

  // What each budget counted keeps being counted: in a budget that stays in
  // its currency, the value it had; otherwise the value in the new one
  const budgetValues = new Map<string, number | null>();
  for (const row of transactions) {
    const next = values.get(row.id);
    if (!next) {
      continue;
    }
    if (!row.category || row.is_parent || isOffBudget(row.account)) {
      budgetValues.set(row.id, null);
      continue;
    }
    const month = monthUtils.monthFromDate(dateOf(row));
    const was = budgetCurrencyBefore(row.category, month);
    const will = budgetCurrencyAfter(row.category, month);
    if (will === toCurrency) {
      budgetValues.set(row.id, null);
      continue;
    }
    const counted =
      row.mc_budget_amount ?? (was === fromCurrency ? row.amount : null);
    budgetValues.set(
      row.id,
      will === was && counted != null
        ? counted
        : await convert(next.value, after(row.account), will, dateOf(row)),
    );
  }

  // Money held for next month is in the default currency, like To Budget:
  // in a month whose budgets keep the old currency it converts, otherwise
  // it keeps its number like those budgets do
  const heldUpdates: Array<{ id: string; buffered: number }> = [];
  if (keepBudgets) {
    const held = await db.all<{ id: string; buffered: number }>(
      `SELECT id, buffered FROM zero_budget_months
        WHERE buffered IS NOT NULL AND buffered != 0 AND id <= ?`,
      [keepUntil],
    );
    for (const row of held) {
      heldUpdates.push({
        id: row.id,
        buffered: await convert(
          row.buffered,
          fromCurrency,
          toCurrency,
          `${row.id}-01`,
        ),
      });
    }
  }
  await lookup.flush();

  // Rules of accounts that get another currency than they had: amounts at
  // today's rate. Rules written for the docs workaround would convert
  // amounts again, so they go.
  const changedAccounts = new Set(
    accounts
      .filter(
        row => !followsDefault(row.id) && after(row.id) !== before(row.id),
      )
      .map(row => row.id),
  );
  const today = monthUtils.currentDay();
  const convertedRules: RuleJS[] = [];
  const workaroundRules: RuleJS[] = [];
  for (const rule of rules) {
    const ruleAccountIds = ruleAccounts(rule);
    if (isWorkaroundRule(rule)) {
      if (
        ruleAccountIds.length > 0 &&
        ruleAccountIds.every(id => after(id) !== fromCurrency)
      ) {
        workaroundRules.push(rule);
      }
      continue;
    }
    const currencies = new Set(ruleAccountIds.map(id => after(id)));
    if (
      ruleAccountIds.length === 0 ||
      !ruleAccountIds.every(id => changedAccounts.has(id)) ||
      currencies.size !== 1
    ) {
      continue;
    }
    const [target] = currencies;
    const source = before(ruleAccountIds[0]);
    const rates = await getRatesAt(source, target, [today]);
    const rate = rates[today];
    // Rule amounts count hundredths whatever the currency (D-018)
    if (
      rate != null &&
      convertRuleAmounts(rule, amount =>
        minorUnitsToHundredths(
          convertMinorUnits(
            hundredthsToMinorUnits(amount, source),
            rate,
            source,
            target,
          ),
          target,
        ),
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
  if (keepBudgets) {
    prefs[MC_PREF_CURRENCY_PERIODS] = JSON.stringify(periods);
  }
  if (reportCurrency?.value === toCurrency) {
    prefs.mcReportCurrency = '';
  }

  let updatedAccounts = 0;
  let updatedTransactions = 0;
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
        updatedAccounts++;
      }
    }
    for (const row of transactions) {
      const next = values.get(row.id);
      if (!next) {
        continue;
      }
      const mcAmount = after(row.account) === toCurrency ? null : next.value;
      const budgetValue = budgetValues.get(row.id) ?? null;
      if (
        next.amount !== row.amount ||
        mcAmount !== row.mc_amount ||
        budgetValue !== row.mc_budget_amount
      ) {
        await db.updateTransaction({
          id: row.id,
          amount: next.amount,
          mc_amount: mcAmount,
          mc_budget_amount: budgetValue,
        });
        // Counted like the preview: a split once
        if (!row.is_child) {
          updatedTransactions++;
        }
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
    for (const update of heldUpdates) {
      await db.update('zero_budget_months', update);
    }
    for (const [id, value] of Object.entries(prefs)) {
      await db.update('preferences', { id, value });
    }
  });
  resetFormulaPreferencesCache();
  await ensureBudgetFactorRates();

  return {
    accounts: updatedAccounts,
    transactions: updatedTransactions,
    rules: convertedRules.length,
    deletedRules,
  };
}
