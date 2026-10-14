// [fork:mc D-014] Exchange rate adjustment for a foreign-currency account:
// a transaction that changes only the budget-currency value, so the account
// counts in the budget at what its balance is worth today.
import { send } from '@actual-app/core/platform/client/connection';
import { currentDay } from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import { realizeTempTransactions } from '@actual-app/core/shared/transactions';
import type { AccountEntity } from '@actual-app/core/types/models';
import { t } from 'i18next';

import { aqlQuery } from '#queries/aqlQuery';

/**
 * Transactions still waiting for a conversion. Their budget value is
 * missing or their account amount is, so a revaluation would be off.
 */
export async function countPendingConversions(
  accountId: AccountEntity['id'],
): Promise<number> {
  const { data } = await aqlQuery(
    q('transactions')
      .filter({
        account: accountId,
        // Each branch needs its own `$and`: AQL joins the keys of an
        // object inside `$or` with OR
        $or: [
          // Waiting for a budget amount
          {
            $and: [
              { amount: 0 },
              { mc_amount: { $ne: null } },
              { mc_amount: { $ne: 0 } },
            ],
          },
          // Waiting for an account amount
          { $and: [{ mc_amount: null }, { amount: { $ne: 0 } }] },
        ],
      })
      .options({ splits: 'none' })
      .calculate({ $count: '$id' }),
  );
  return typeof data === 'number' ? data : 0;
}

/**
 * Adds a cleared transaction of `difference` in the budget currency and 0 in
 * the account's currency, dated today. It runs through the rules, so a rule
 * on its notes can categorize it.
 */
export async function createRevaluationTransaction(
  accountId: AccountEntity['id'],
  difference: number,
) {
  const [transaction] = realizeTempTransactions([
    {
      id: 'temp',
      account: accountId,
      cleared: true,
      reconciled: false,
      amount: difference,
      mc_amount: 0,
      date: currentDay(),
      notes: t('Exchange rate adjustment'),
    },
  ]);
  const ruled = await send('rules-run', { transaction });
  await send('transactions-batch-update', {
    // Rules can't change the amounts of this adjustment
    added: [{ ...ruled, amount: difference, mc_amount: 0 }],
  });
}
