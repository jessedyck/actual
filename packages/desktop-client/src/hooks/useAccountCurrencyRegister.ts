// [fork:mc D-013] Shows a foreign-currency account's register in the
// account's own currency by swapping `amount` and `mc_amount` on the way in
// and back on the way out (see `toAccountCurrencyView` in the fork's shared
// helpers). Every function is the identity for any other register.
import { useMemo } from 'react';

import {
  convertMinorUnits,
  diffFromAccountCurrencyView,
  fromAccountCurrencyView,
  minorUnitsToHundredths,
  toAccountCurrencyView,
  updatesToAccountCurrencyView,
} from '@actual-app/core/shared/multi-currency';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { useMcRate } from '#hooks/useMcRate';
import { useAccountCurrency } from '#hooks/useMultiCurrency';

type Diff = {
  added?: Array<Partial<TransactionEntity>>;
  updated?: Array<Partial<TransactionEntity>>;
  deleted?: Array<Partial<TransactionEntity>>;
};

export type AccountCurrencyRegister = {
  isActive: boolean;
  currency: string;
  toView: <T extends TransactionEntity>(transactions: readonly T[]) => T[];
  fromView: <T extends TransactionEntity>(transactions: readonly T[]) => T[];
  diffFromView: <D extends Diff>(diff: D) => D;
  updatesToView: (
    updates: ReadonlyArray<Partial<TransactionEntity>>,
  ) => Array<Partial<TransactionEntity>>;
  /** Running balances summed from `mc_amount`, in the register's units */
  balancesToView: (
    balances: Record<string, number> | null,
  ) => Record<string, number> | null;
};

export function useAccountCurrencyRegister(
  account: Pick<AccountEntity, 'mc_currency'> | null | undefined,
): AccountCurrencyRegister {
  const { isForeign, currency, budgetCurrency } = useAccountCurrency(account);
  // Today's rate estimates rows that have no account amount yet (schedule
  // previews, pending conversions)
  const rate = useMcRate(
    isForeign ? currency : '',
    isForeign ? budgetCurrency : '',
  );
  const rateValue = rate.status === 'found' ? rate.rate : null;

  return useMemo(() => {
    const estimate = (budgetAmount: number) =>
      rateValue
        ? convertMinorUnits(
            budgetAmount,
            1 / rateValue,
            budgetCurrency,
            currency,
          )
        : null;

    if (!isForeign) {
      // Same arrays back, so upstream renders exactly as before
      return {
        isActive: false,
        currency,
        toView: <T extends TransactionEntity>(transactions: readonly T[]) =>
          transactions as T[],
        fromView: <T extends TransactionEntity>(transactions: readonly T[]) =>
          transactions as T[],
        diffFromView: diff => diff,
        updatesToView: updates => [...updates],
        balancesToView: balances => balances,
      };
    }
    return {
      isActive: true,
      currency,
      toView: transactions =>
        transactions.map(transaction =>
          toAccountCurrencyView(transaction, { currency, estimate }),
        ),
      fromView: transactions =>
        transactions.map(transaction =>
          fromAccountCurrencyView(transaction, currency),
        ),
      diffFromView: diff => diffFromAccountCurrencyView(diff, currency),
      updatesToView: updates =>
        updatesToAccountCurrencyView([...updates], currency),
      balancesToView: balances =>
        balances &&
        Object.fromEntries(
          Object.entries(balances).map(([id, balance]) => [
            id,
            minorUnitsToHundredths(balance, currency),
          ]),
        ),
    };
  }, [isForeign, currency, budgetCurrency, rateValue]);
}
