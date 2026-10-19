// [fork:mc D-013] Shows a foreign-currency account's register in the
// account's own currency by swapping `amount` and `mc_amount` on the way in
// and back on the way out (see `toAccountCurrencyView` in the fork's shared
// helpers). Every function is the identity for any other register.
//
// A register of several accounts at once (All accounts, On budget, a
// category's transactions) passes `mixed`: each transaction is then shown in
// its own account's currency, and running balances stay in the budget
// currency.
import { useEffect, useMemo, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import {
  convertMinorUnits,
  diffFromAccountCurrencyView,
  diffFromAccountCurrencyViews,
  fromAccountCurrencyView,
  isForeignCurrencyAccount,
  minorUnitsToHundredths,
  toAccountCurrencyView,
  updatesToAccountCurrencyView,
} from '@actual-app/core/shared/multi-currency';
import type { AccountCurrencyViewFields } from '@actual-app/core/shared/multi-currency';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { useAccounts } from '#hooks/useAccounts';
import { useMcRate } from '#hooks/useMcRate';
import { useAccountCurrency, useMultiCurrency } from '#hooks/useMultiCurrency';

type Diff = {
  added?: Array<Partial<TransactionEntity>>;
  updated?: Array<Partial<TransactionEntity>>;
  deleted?: Array<Partial<TransactionEntity>>;
};

export type AccountCurrencyRegister = {
  isActive: boolean;
  currency: string;
  /** The currency a transaction is shown in, when not the budget currency */
  currencyFor: (
    transaction: Pick<TransactionEntity, 'account'>,
  ) => string | null;
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

/** Today's rate from each currency in `codes` to `quote`. */
function useTodayRates(codes: string, quote: string): Record<string, number> {
  const [rates, setRates] = useState<Record<string, number>>({});

  useEffect(() => {
    let isCurrent = true;
    if (!codes || !quote) {
      return;
    }
    const today = monthUtils.currentDay();
    void Promise.all(
      codes.split(',').map(async code => {
        const lookup = await send('mc-get-rate', {
          date: today,
          base: code,
          quote,
        }).catch(() => null);
        return [code, lookup?.rate] as const;
      }),
    ).then(entries => {
      if (isCurrent) {
        setRates(
          Object.fromEntries(
            entries.filter((entry): entry is [string, number] =>
              Boolean(entry[1]),
            ),
          ),
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [codes, quote]);

  return rates;
}

export function useAccountCurrencyRegister(
  account: Pick<AccountEntity, 'mc_currency'> | null | undefined,
  { mixed = false }: { mixed?: boolean } = {},
): AccountCurrencyRegister {
  const { isForeign, currency, budgetCurrency } = useAccountCurrency(account);
  // Today's rate estimates rows that have no account amount yet (schedule
  // previews, pending conversions)
  const rate = useMcRate(
    isForeign ? currency : '',
    isForeign ? budgetCurrency : '',
  );
  const rateValue = rate.status === 'found' ? rate.rate : null;

  // Several accounts: each one's currency when it differs from the budget's
  const { isEnabled } = useMultiCurrency();
  const { data: accounts } = useAccounts();
  const currencyByAccount = useMemo(
    () =>
      new Map(
        mixed && isEnabled
          ? (accounts ?? [])
              .filter(item => isForeignCurrencyAccount(item, budgetCurrency))
              .map(item => [item.id, item.mc_currency as string])
          : [],
      ),
    [mixed, isEnabled, accounts, budgetCurrency],
  );
  const foreignCodes = [...new Set(currencyByAccount.values())]
    .sort()
    .join(',');
  const todayRates = useTodayRates(foreignCodes, budgetCurrency);

  return useMemo((): AccountCurrencyRegister => {
    if (currencyByAccount.size > 0) {
      return mixedRegister(currencyByAccount, todayRates, budgetCurrency);
    }

    const estimate = (budgetAmount: number) =>
      rateValue
        ? convertMinorUnits(
            budgetAmount,
            1 / rateValue,
            budgetCurrency,
            currency,
          )
        : null;
    // [fork:mc D-018] What a schedule preview is worth today
    const estimateBudget = (accountAmount: number) =>
      rateValue
        ? convertMinorUnits(accountAmount, rateValue, currency, budgetCurrency)
        : null;

    if (!isForeign) {
      // Same arrays back, so upstream renders exactly as before
      return {
        isActive: false,
        currency,
        currencyFor: () => null,
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
      currencyFor: () => currency,
      toView: transactions =>
        transactions.map(transaction =>
          toAccountCurrencyView(transaction, {
            currency,
            estimate,
            estimateBudget,
          }),
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
  }, [
    currencyByAccount,
    todayRates,
    isForeign,
    currency,
    budgetCurrency,
    rateValue,
  ]);
}

/**
 * Each transaction in its own account's currency. The account of every
 * transaction shown is remembered so a diff that only names a transaction's
 * id can still be read in the right currency.
 */
function mixedRegister(
  currencyByAccount: ReadonlyMap<string, string>,
  todayRates: Record<string, number>,
  budgetCurrency: string,
): AccountCurrencyRegister {
  const accountById = new Map<string, string>();
  const currencyOf = (accountId: string | null | undefined) =>
    (accountId && currencyByAccount.get(accountId)) || null;
  const estimateFor = (code: string) => {
    const rate = todayRates[code];
    return rate
      ? (budgetAmount: number) =>
          convertMinorUnits(budgetAmount, 1 / rate, budgetCurrency, code)
      : undefined;
  };
  // [fork:mc D-018] What a schedule preview is worth today
  const estimateBudgetFor = (code: string) => {
    const rate = todayRates[code];
    return rate
      ? (accountAmount: number) =>
          convertMinorUnits(accountAmount, rate, code, budgetCurrency)
      : undefined;
  };
  const remember = (transaction: TransactionEntity) => {
    if (transaction.id && transaction.account) {
      accountById.set(transaction.id, transaction.account);
    }
    transaction.subtransactions?.forEach(remember);
  };

  return {
    isActive: true,
    currency: budgetCurrency,
    currencyFor: transaction => currencyOf(transaction.account),
    toView: transactions =>
      transactions.map(transaction => {
        remember(transaction);
        const code = currencyOf(transaction.account);
        return code
          ? toAccountCurrencyView(transaction, {
              currency: code,
              estimate: estimateFor(code),
              estimateBudget: estimateBudgetFor(code),
            })
          : transaction;
      }),
    fromView: transactions =>
      transactions.map(transaction => {
        const view = transaction as typeof transaction &
          AccountCurrencyViewFields;
        if (!view._mcView) {
          return transaction;
        }
        const code = currencyOf(transaction.account);
        if (code) {
          return fromAccountCurrencyView(view, code);
        }
        // Moved to a budget-currency account while shown: the budget amount
        // stands and the server derives the rest (D-006)
        const { _mcView, _mcBudgetAmount, _mcEstimate, ...rest } = view;
        return { ...rest, amount: _mcBudgetAmount ?? 0 } as typeof transaction;
      }),
    diffFromView: diff =>
      diffFromAccountCurrencyViews(
        diff,
        id => accountById.get(String(id)),
        currencyOf,
      ),
    updatesToView: updates =>
      updates.map(update => {
        const code = currencyOf(
          update.account ?? (update.id ? accountById.get(update.id) : null),
        );
        return code ? updatesToAccountCurrencyView([update], code)[0] : update;
      }),
    balancesToView: balances => balances,
  };
}
