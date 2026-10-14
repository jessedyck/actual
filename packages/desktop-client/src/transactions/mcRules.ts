// [fork:mc D-013] Rules for a transaction held in its account's currency
// (the desktop register and the mobile editor of a foreign-currency
// account).
import { send } from '@actual-app/core/platform/client/connection';
import { hundredthsToMinorUnits } from '@actual-app/core/shared/multi-currency';
import type { TransactionEntity } from '@actual-app/core/types/models';

/**
 * Runs rules on stored fields: the typed amount as `mc_amount` and a budget
 * amount of 0, which the server derives on save. Rules can't change the
 * amount being typed, and split rules (computed from the budget amount)
 * don't apply.
 */
export async function runRulesInAccountCurrency(
  transaction: TransactionEntity,
  currency: string | null,
): Promise<TransactionEntity> {
  if (!currency) {
    return send('rules-run', { transaction });
  }
  const afterRules = await send('rules-run', {
    transaction: {
      ...transaction,
      amount: 0,
      mc_amount: hundredthsToMinorUnits(transaction.amount, currency),
    },
  });
  return {
    ...afterRules,
    amount: transaction.amount,
    mc_amount: transaction.mc_amount,
    subtransactions: transaction.subtransactions,
  };
}
