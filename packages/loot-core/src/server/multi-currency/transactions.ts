// [fork:mc D-006] Keeps `amount` (budget currency) and `mc_amount` (account
// currency) consistent for transactions in foreign-currency accounts. Runs
// inside `batchUpdateTransactions`, so every write path that goes through it
// (register, mobile, imports, API, rules, schedules) gets the same behaviour.
//
// Rules, for an account whose currency differs from the budget currency:
// - New transaction with only an account-currency amount: derive `amount`.
// - New transaction with only `amount` (old clients, transfer mirrors, API):
//   derive `mc_amount`.
// - Edited `mc_amount` with `amount` untouched: re-derive `amount`, except on
//   the side of a transfer whose budget value mirrors the other side.
// - Edited `amount` alone is a manual override of the budget value: kept.
// - Moved to an account with another currency: re-derive `mc_amount`.
// - No rate available: `amount` becomes 0 and the row counts as pending until
//   `mc-recompute-pending` runs with a rate.
// - Moved to (or written on) a budget-currency account: `mc_amount` cleared.
// Splits are rounded so children still add up to the parent exactly.
//
// [fork:mc D-017] Conversions use the rate of the transaction's month (the
// month's average, see `month-rates.ts`). A categorized transaction whose
// budget is in another currency than the default one also gets
// `mc_budget_amount`, its value in that currency.
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import type { TransactionEntity } from '#types/models';

import {
  createMonthRateLookup,
  getBudgetCurrencyOf,
  loadAccountCurrencies,
  loadBudgetCurrencies,
} from './month-rates';
import type { BudgetCurrencies, MonthRateLookup } from './month-rates';
import { getMultiCurrencyContext } from './rates';
import type { MultiCurrencyContext } from './rates';

type Change = Partial<TransactionEntity>;

type StoredRow = {
  id: string;
  account: string;
  category: string | null;
  amount: number;
  mc_amount: number | null;
  mc_budget_amount: number | null;
  date: string;
  transfer_id: string | null;
  is_parent: boolean;
  is_child: boolean;
  parent_id: string | null;
};

type RawRow = {
  id: string;
  account: string;
  category: string | null;
  amount: number;
  mc_amount: number | null;
  mc_budget_amount: number | null;
  date: number;
  transfer_id: string | null;
  is_parent: 0 | 1;
  is_child: 0 | 1;
  parent_id: string | null;
};

const ROW_FIELDS =
  'id, account, category, amount, mc_amount, mc_budget_amount, date, transfer_id, is_parent, is_child, parent_id';

function toStoredRow(row: RawRow): StoredRow {
  return {
    ...row,
    date: db.fromDateRepr(row.date),
    is_parent: row.is_parent === 1,
    is_child: row.is_child === 1,
  };
}

async function loadRows(
  ids: string[],
  where: 'id' | 'parent_id' = 'id',
): Promise<StoredRow[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) {
    return [];
  }
  const rows = await db.all<RawRow>(
    `SELECT ${ROW_FIELDS} FROM v_transactions_internal_alive
      WHERE ${where} IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  return rows.map(toStoredRow);
}

/** Map of account id to currency, for accounts in a foreign currency. */
export async function loadForeignAccounts(
  budgetCurrency: string,
): Promise<Map<string, string>> {
  const accounts = await loadAccountCurrencies(budgetCurrency);
  return new Map([...accounts].filter(([, code]) => code !== budgetCurrency));
}

/** [fork:mc D-017] What a write needs to know about currencies. */
type CurrencySetup = {
  context: MultiCurrencyContext;
  foreign: Map<string, string>;
  budgets: BudgetCurrencies;
  offBudget: Set<string>;
  lookup: MonthRateLookup;
};

/** Null when nothing in the budget file is in another currency. */
async function loadCurrencySetup(): Promise<CurrencySetup | null> {
  const context = await getMultiCurrencyContext();
  if (!context.enabled) {
    return null;
  }
  const foreign = await loadForeignAccounts(context.budgetCurrency);
  const budgets = await loadBudgetCurrencies();
  if (
    foreign.size === 0 &&
    budgets.size === 0 &&
    context.periods.length === 0
  ) {
    return null;
  }
  const offBudget = await db.all<Pick<db.DbAccount, 'id'>>(
    'SELECT id FROM accounts WHERE offbudget = 1 AND tombstone = 0',
  );
  return {
    context,
    foreign,
    budgets,
    offBudget: new Set(offBudget.map(row => row.id)),
    lookup: createMonthRateLookup(),
  };
}

function hasKey<K extends string>(
  object: object,
  key: K,
): object is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key);
}

type Plan = {
  change: Change;
  currency: string;
  date: string;
  derive: 'amount' | 'mc_amount';
};

/**
 * Mutates `added` and `updated` in place and returns extra updates for rows
 * outside the batch (split siblings that absorb a rounding difference).
 */
export async function prepareMultiCurrencyChanges({
  added = [],
  updated = [],
  deleted = [],
}: {
  added?: Change[];
  updated?: Change[];
  deleted?: Array<Pick<TransactionEntity, 'id'>>;
}): Promise<Change[]> {
  if (added.length === 0 && updated.length === 0) {
    return [];
  }
  const setup = await loadCurrencySetup();
  if (!setup) {
    return [];
  }
  const { foreign, lookup } = setup;
  const budgetCurrency = setup.context.budgetCurrency;

  const oldById = new Map(
    (
      await loadRows(
        updated
          .map(change => change.id)
          .filter((id): id is string => Boolean(id)),
      )
    ).map(row => [row.id, row]),
  );

  // Transfer partners decide whose budget value is authoritative
  const partnerIds = updated
    .map(
      change =>
        change.transfer_id ??
        (change.id ? oldById.get(change.id)?.transfer_id : undefined),
    )
    .filter((id): id is string => Boolean(id));
  const partnerAccount = new Map(
    (await loadRows(partnerIds)).map(row => [row.id, row.account]),
  );

  const plans: Plan[] = [];

  for (const change of added) {
    const currency = change.account ? foreign.get(change.account) : undefined;
    if (!currency) {
      if (change.mc_amount != null) {
        change.mc_amount = null;
      }
      continue;
    }
    const date = change.date as string;
    const mc = change.mc_amount;
    const amount = change.amount;
    if (mc != null && mc !== 0 && !amount) {
      plans.push({ change, currency, date, derive: 'amount' });
    } else if (mc == null && amount != null && amount !== 0) {
      plans.push({ change, currency, date, derive: 'mc_amount' });
    }
  }

  for (const change of updated) {
    const old = change.id ? oldById.get(change.id) : undefined;
    if (!old) {
      continue;
    }
    const account = change.account ?? old.account;
    const currency = foreign.get(account);
    const oldCurrency = foreign.get(old.account);

    if (!currency) {
      if (
        (hasKey(change, 'mc_amount') && change.mc_amount != null) ||
        (old.mc_amount != null && account !== old.account)
      ) {
        change.mc_amount = null;
      }
      continue;
    }

    const date = change.date ?? old.date;
    const newMc = hasKey(change, 'mc_amount')
      ? change.mc_amount
      : old.mc_amount;
    const newAmount = hasKey(change, 'amount')
      ? (change.amount as number)
      : old.amount;
    const mcChanged = newMc !== old.mc_amount;
    const amountChanged = newAmount !== old.amount;

    if (account !== old.account && oldCurrency !== currency) {
      // The old account-currency amount means nothing in the new currency
      plans.push({
        change,
        currency,
        date,
        derive: mcChanged && !amountChanged ? 'amount' : 'mc_amount',
      });
      continue;
    }

    if (mcChanged && !amountChanged) {
      const transferId = change.transfer_id ?? old.transfer_id;
      const partner = transferId ? partnerAccount.get(transferId) : undefined;
      const followsPartner =
        partner !== undefined &&
        (!foreign.has(partner) || (newMc ?? newAmount) > 0);
      if (!followsPartner) {
        plans.push({ change, currency, date, derive: 'amount' });
      }
    } else if (newMc == null && newAmount !== 0) {
      plans.push({ change, currency, date, derive: 'mc_amount' });
    }
  }

  // [fork:mc D-017] At the rate of the transaction's month
  for (const { change, currency, date, derive } of plans) {
    const old = change.id ? oldById.get(change.id) : undefined;
    if (derive === 'amount') {
      const mc = hasKey(change, 'mc_amount')
        ? change.mc_amount
        : (old?.mc_amount ?? null);
      change.amount =
        mc == null
          ? (change.amount ?? old?.amount ?? 0)
          : ((await lookup.convert(mc, date, currency, budgetCurrency)) ?? 0);
    } else {
      const amount = hasKey(change, 'amount')
        ? (change.amount as number)
        : (old?.amount ?? 0);
      change.mc_amount = await lookup.convert(
        amount,
        date,
        budgetCurrency,
        currency,
      );
    }
  }

  const extra = await roundSplits({
    added,
    updated,
    deleted,
    plans,
    oldById,
    foreign,
  });
  await prepareBudgetAmounts(setup, added, updated, oldById);
  await lookup.flush();
  return extra;
}

const BUDGET_FIELDS = [
  'account',
  'date',
  'category',
  'amount',
  'mc_amount',
  'is_parent',
  'mc_budget_amount',
];

/**
 * [fork:mc D-017] A categorized transaction's value in its budget's
 * currency, when that isn't the default currency: its account amount when
 * the currencies match, otherwise converted at its month's rate (0 while no
 * rate is known). Cleared when its budget is in the default currency.
 */
async function prepareBudgetAmounts(
  setup: CurrencySetup,
  added: Change[],
  updated: Change[],
  oldById: Map<string, StoredRow>,
): Promise<void> {
  const defaultCurrency = setup.context.budgetCurrency;
  const changes = [
    ...added.map(change => ({ change, old: undefined })),
    ...updated.map(change => ({
      change,
      old: change.id ? oldById.get(change.id) : undefined,
    })),
  ];
  for (const { change, old } of changes) {
    if (old && !BUDGET_FIELDS.some(field => hasKey(change, field))) {
      continue;
    }
    if (!old && change.id && updated.includes(change)) {
      continue;
    }
    const account = change.account ?? old?.account;
    const date = change.date ?? old?.date;
    if (!account || !date) {
      continue;
    }
    const category = hasKey(change, 'category')
      ? change.category
      : old?.category;
    const isParent = change.is_parent ?? old?.is_parent;
    let value: number | null = null;
    if (category && !isParent && !setup.offBudget.has(account)) {
      const budgetCurrency = getBudgetCurrencyOf(
        setup.context,
        setup.budgets,
        category,
        date,
      );
      if (budgetCurrency !== defaultCurrency) {
        const currency = setup.foreign.get(account) ?? defaultCurrency;
        const amount = hasKey(change, 'amount')
          ? (change.amount as number)
          : (old?.amount ?? 0);
        const mc = hasKey(change, 'mc_amount')
          ? (change.mc_amount ?? null)
          : (old?.mc_amount ?? null);
        const own = currency === defaultCurrency ? amount : mc;
        value =
          own == null
            ? 0
            : currency === budgetCurrency
              ? own
              : ((await setup.lookup.convert(
                  own,
                  date,
                  currency,
                  budgetCurrency,
                )) ?? 0);
      }
    }
    if (value !== (old?.mc_budget_amount ?? null)) {
      change.mc_budget_amount = value;
    }
  }
}

/**
 * Converting each split child separately can leave the children a minor
 * unit or two away from the parent. Push the difference onto the largest
 * child so the split stays valid.
 */
async function roundSplits({
  added,
  updated,
  deleted,
  plans,
  oldById,
  foreign,
}: {
  added: Change[];
  updated: Change[];
  deleted: Array<Pick<TransactionEntity, 'id'>>;
  plans: Plan[];
  oldById: Map<string, StoredRow>;
  foreign: Map<string, string>;
}): Promise<Change[]> {
  const parentIds = new Set<string>();
  for (const { change } of plans.filter(plan => plan.derive === 'amount')) {
    if (!change.id) {
      continue;
    }
    const old = oldById.get(change.id);
    if (change.is_parent ?? old?.is_parent) {
      parentIds.add(change.id);
    }
    const parentId = change.parent_id ?? old?.parent_id;
    if ((change.is_child ?? old?.is_child) && parentId) {
      parentIds.add(parentId);
    }
  }
  if (parentIds.size === 0) {
    return [];
  }

  const deletedIds = new Set(deleted.map(item => item.id));
  const batch = new Map<string, Change>();
  for (const change of [...added, ...updated]) {
    if (change.id) {
      batch.set(change.id, change);
    }
  }
  const stored = new Map<string, StoredRow>();
  for (const row of [
    ...(await loadRows([...parentIds])),
    ...(await loadRows([...parentIds], 'parent_id')),
  ]) {
    stored.set(row.id, row);
  }

  const amountOf = (id: string) =>
    batch.get(id)?.amount ?? stored.get(id)?.amount ?? 0;
  const parentOf = (id: string) =>
    batch.get(id)?.parent_id ?? stored.get(id)?.parent_id ?? null;
  const extra: Change[] = [];

  for (const parentId of parentIds) {
    const parentAccount =
      batch.get(parentId)?.account ?? stored.get(parentId)?.account;
    if (!parentAccount || !foreign.has(parentAccount)) {
      continue;
    }
    const childIds = [...new Set([...batch.keys(), ...stored.keys()])].filter(
      id => id !== parentId && parentOf(id) === parentId && !deletedIds.has(id),
    );
    if (childIds.length === 0) {
      continue;
    }
    const difference =
      amountOf(parentId) -
      childIds.reduce((total, id) => total + amountOf(id), 0);
    // Anything bigger than rounding is a real mismatch the user must fix
    if (difference === 0 || Math.abs(difference) > childIds.length) {
      continue;
    }
    const target = childIds.reduce((largest, id) =>
      Math.abs(amountOf(id)) > Math.abs(amountOf(largest)) ? id : largest,
    );
    const newAmount = amountOf(target) + difference;
    const inBatch = batch.get(target);
    if (inBatch) {
      inBatch.amount = newAmount;
    } else {
      extra.push({ id: target, amount: newAmount });
    }
  }
  return extra;
}

/**
 * After transfers are created or mirrored, give the foreign-currency side an
 * account-currency amount if it has none yet. Existing values are never
 * overwritten: they may be what the bank actually credited.
 */
export async function fillTransferMirrors(
  transactionIds: string[],
): Promise<void> {
  if (transactionIds.length === 0) {
    return;
  }
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    return;
  }
  const foreign = await loadForeignAccounts(budgetCurrency);
  if (foreign.size === 0) {
    return;
  }
  const lookup = createMonthRateLookup();
  const sources = await loadRows(transactionIds);
  const partners = (
    await loadRows(
      sources
        .map(row => row.transfer_id)
        .filter((id): id is string => Boolean(id)),
    )
  ).filter(row => row.mc_amount == null && foreign.has(row.account));

  // Look up every rate first so the writes can go out as one batch
  const updates: Array<{ id: string; mc_amount: number }> = [];
  for (const partner of partners) {
    const currency = foreign.get(partner.account) as string;
    const mcAmount = await lookup.convert(
      partner.amount,
      partner.date,
      budgetCurrency,
      currency,
    );
    if (mcAmount != null) {
      updates.push({ id: partner.id, mc_amount: mcAmount });
    }
  }
  await lookup.flush();
  if (updates.length > 0) {
    await batchMessages(async () => {
      for (const update of updates) {
        await db.updateTransaction(update);
      }
    });
  }
}
