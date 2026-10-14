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
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { isForeignCurrencyAccount } from '#shared/multi-currency';
import type { TransactionEntity } from '#types/models';

import { convertAmount, ensureRates, getMultiCurrencyContext } from './rates';

type Change = Partial<TransactionEntity>;

type StoredRow = {
  id: string;
  account: string;
  amount: number;
  mc_amount: number | null;
  date: string;
  transfer_id: string | null;
  is_parent: boolean;
  is_child: boolean;
  parent_id: string | null;
};

type RawRow = {
  id: string;
  account: string;
  amount: number;
  mc_amount: number | null;
  date: number;
  transfer_id: string | null;
  is_parent: 0 | 1;
  is_child: 0 | 1;
  parent_id: string | null;
};

const ROW_FIELDS =
  'id, account, amount, mc_amount, date, transfer_id, is_parent, is_child, parent_id';

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
  const rows = await db.all<Pick<db.DbAccount, 'id' | 'mc_currency'>>(
    'SELECT id, mc_currency FROM accounts WHERE mc_currency IS NOT NULL AND tombstone = 0',
  );
  return new Map(
    rows
      .filter(row => isForeignCurrencyAccount(row, budgetCurrency))
      .map(row => [row.id, row.mc_currency as string]),
  );
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
  const { enabled, budgetCurrency } = await getMultiCurrencyContext();
  if (!enabled) {
    return [];
  }
  const foreign = await loadForeignAccounts(budgetCurrency);
  if (foreign.size === 0) {
    return [];
  }

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

  // One range request per currency instead of one per transaction
  const datesByCurrency = new Map<string, string[]>();
  for (const plan of plans) {
    const dates = datesByCurrency.get(plan.currency) ?? [];
    dates.push(plan.date);
    datesByCurrency.set(plan.currency, dates);
  }
  for (const [currency, dates] of datesByCurrency) {
    await ensureRates(currency, budgetCurrency, dates);
  }

  for (const { change, currency, date, derive } of plans) {
    const old = change.id ? oldById.get(change.id) : undefined;
    if (derive === 'amount') {
      const mc = hasKey(change, 'mc_amount')
        ? change.mc_amount
        : (old?.mc_amount ?? null);
      change.amount =
        mc == null
          ? (change.amount ?? old?.amount ?? 0)
          : ((await convertAmount(mc, date, currency, budgetCurrency)) ?? 0);
    } else {
      const amount = hasKey(change, 'amount')
        ? (change.amount as number)
        : (old?.amount ?? 0);
      change.mc_amount = await convertAmount(
        amount,
        date,
        budgetCurrency,
        currency,
      );
    }
  }

  return roundSplits({ added, updated, deleted, plans, oldById, foreign });
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
    await ensureRates(currency, budgetCurrency, [partner.date]);
    const mcAmount = await convertAmount(
      partner.amount,
      partner.date,
      budgetCurrency,
      currency,
    );
    if (mcAmount != null) {
      updates.push({ id: partner.id, mc_amount: mcAmount });
    }
  }
  if (updates.length > 0) {
    await batchMessages(async () => {
      for (const update of updates) {
        await db.updateTransaction(update);
      }
    });
  }
}
