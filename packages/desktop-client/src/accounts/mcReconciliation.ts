// [fork:mc D-008] Reconciling a foreign-currency account happens in the
// account's currency: the statement balance, the cleared balance and the
// adjustment transaction are all account-currency amounts. Mirrors upstream's
// `accounts/reconciliation.ts`, which sums budget amounts.
import { send } from '@actual-app/core/platform/client/connection';
import { currentDay } from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import { realizeTempTransactions } from '@actual-app/core/shared/transactions';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import { t } from 'i18next';

import { aqlQuery } from '#queries/aqlQuery';

import { lockTransactions } from './reconciliation';

/** Cleared balance in the account's currency (sum of `mc_amount`). */
export async function getMcClearedBalance(
  accountId: AccountEntity['id'],
): Promise<number> {
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ cleared: true, account: accountId })
      .options({ splits: 'none' })
      .calculate({ $sum: '$mc_amount' }),
  );
  return typeof data === 'number' ? data : 0;
}

/** Locks the cleared transactions when they match the statement balance. */
export async function finishMcReconciliation(
  accountId: AccountEntity['id'],
  reconcileAmount: number | null,
  lock: () => Promise<void> = () => lockTransactions(accountId),
) {
  const cleared = await getMcClearedBalance(accountId);
  if ((reconcileAmount ?? 0) - cleared === 0) {
    await lock();
  }
}

/**
 * Adds a cleared adjustment of `diff` in the account's currency. Its budget
 * amount is left at 0 so the server converts it (D-006).
 */
export async function createMcReconciliationTransaction(
  accountId: AccountEntity['id'],
  diff: number,
  onRealized?: (transactions: TransactionEntity[]) => void,
) {
  const reconciliationTransactions = realizeTempTransactions([
    {
      id: 'temp',
      account: accountId,
      cleared: true,
      reconciled: false,
      amount: 0,
      mc_amount: diff,
      date: currentDay(),
      notes: t('Reconciliation balance adjustment'),
    },
  ]);

  onRealized?.(reconciliationTransactions);

  const ruledTransactions = await Promise.all(
    reconciliationTransactions.map(transaction =>
      send('rules-run', { transaction }),
    ),
  );

  await send('transactions-batch-update', {
    added: ruledTransactions.filter(trans => !trans.tombstone),
    deleted: ruledTransactions.filter(trans => trans.tombstone),
  });
}
