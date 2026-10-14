// [fork:mc D-012] Live balance of a foreign-currency account in its own
// currency (the sum of `mc_amount`), split into cleared and uncleared.
// Upstream's balance bindings sum `amount`, the budget-currency value.
import { q } from '@actual-app/core/shared/query';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useQuery } from '#hooks/useQuery';

export type McAccountBalance = {
  balance: number;
  cleared: number;
  uncleared: number;
};

type Row = { cleared: boolean; total: number | null };

export function useMcAccountBalance(
  accountId: AccountEntity['id'] | null | undefined,
): McAccountBalance | null {
  const { data } = useQuery<Row>(
    () =>
      accountId
        ? q('transactions')
            .filter({ account: accountId })
            .options({ splits: 'none' })
            .groupBy('cleared')
            .select(['cleared', { total: { $sum: '$mc_amount' } }])
        : null,
    [accountId],
  );
  if (!data) {
    return null;
  }
  let cleared = 0;
  let uncleared = 0;
  for (const row of data) {
    if (row.cleared) {
      cleared += row.total ?? 0;
    } else {
      uncleared += row.total ?? 0;
    }
  }
  return { balance: cleared + uncleared, cleared, uncleared };
}
