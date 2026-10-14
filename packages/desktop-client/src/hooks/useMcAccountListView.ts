// [fork:mc D-013] The mobile page of a foreign-currency account in its own
// currency: transactions, scheduled previews and running balances. Upstream
// computes running balances from budget amounts and the budget-currency
// account balance, so the fork computes them again from the account view.
import { useMemo } from 'react';

import { minorUnitsToHundredths } from '@actual-app/core/shared/multi-currency';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { useAccountCurrencyRegister } from '#hooks/useAccountCurrencyRegister';
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import {
  calculateRunningBalancesBottomUp,
  calculateRunningBalancesTopDown,
} from '#hooks/useTransactions';

export type McAccountListView = {
  /** Transactions (and previews) as the list shows them */
  toView: <T extends TransactionEntity>(transactions: readonly T[]) => T[];
  runningBalances: Map<TransactionEntity['id'], IntegerAmount>;
};

/** Null for any account that isn't in a foreign currency. */
export function useMcAccountListView({
  account,
  transactions,
  previewTransactions,
}: {
  account: AccountEntity;
  transactions: readonly TransactionEntity[];
  previewTransactions: readonly TransactionEntity[];
}): McAccountListView | null {
  const mcRegister = useAccountCurrencyRegister(account);
  const balance = useMcAccountBalance(
    mcRegister.isActive ? account.id : null,
  )?.balance;

  return useMemo(() => {
    if (!mcRegister.isActive) {
      return null;
    }
    // Same starting point as upstream: the whole account's balance
    const startingBalance = minorUnitsToHundredths(
      balance ?? 0,
      mcRegister.currency,
    );
    return {
      toView: mcRegister.toView,
      runningBalances: new Map([
        ...calculateRunningBalancesBottomUp(
          mcRegister.toView(previewTransactions),
          'all',
          startingBalance,
        ),
        ...calculateRunningBalancesTopDown(
          mcRegister.toView(transactions),
          'all',
          startingBalance,
        ),
      ]),
    };
  }, [mcRegister, balance, transactions, previewTransactions]);
}
