// [fork:mc D-013] In a register of several accounts (All accounts, On
// budget, a category's transactions), amounts carry their currency: a CAD
// account's transaction reads "12,50 CA$" next to "30,00 €". A single
// account's register keeps upstream's plain numbers; its header shows the
// currency.
import {
  hundredthsToMinorUnits,
  isForeignCurrencyAccount,
} from '@actual-app/core/shared/multi-currency';
import type { AccountCurrencyViewFields } from '@actual-app/core/shared/multi-currency';
import {
  amountToInteger,
  currencyToAmount,
} from '@actual-app/core/shared/util';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { useAccounts } from '#hooks/useAccounts';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

export type McAmountCellFormatter = {
  /** A Payment or Deposit cell's text, with its currency */
  amount: (value: string) => string;
  /** A running balance, in the budget currency */
  balance: (value: number) => string;
};

/** Null when the register shows plain numbers. */
export function useMcAmountCellFormatter(
  transaction: TransactionEntity,
  isSeveralAccounts: boolean,
): McAmountCellFormatter | null {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const { data: accounts = [] } = useAccounts();
  const mcFormat = useMultiCurrencyFormat();

  if (!isEnabled || !isSeveralAccounts) {
    return null;
  }
  const foreign = accounts.filter(account =>
    isForeignCurrencyAccount(account, budgetCurrency),
  );
  if (foreign.length === 0) {
    return null;
  }
  const view: TransactionEntity & AccountCurrencyViewFields = transaction;
  const code =
    (view._mcView &&
      foreign.find(account => account.id === transaction.account)
        ?.mc_currency) ||
    budgetCurrency;

  return {
    amount: value => {
      const parsed = currencyToAmount(value);
      return parsed == null
        ? value
        : mcFormat.format(
            hundredthsToMinorUnits(amountToInteger(parsed), code),
            code,
          );
    },
    balance: value => mcFormat.format(value, budgetCurrency),
  };
}

/** Extra characters amount columns need for the symbols they show. */
export function useMcAmountSymbolChars(isSeveralAccounts: boolean): number {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const { data: accounts = [] } = useAccounts();
  const mcFormat = useMultiCurrencyFormat();

  if (!isEnabled || !isSeveralAccounts) {
    return 0;
  }
  const codes = accounts
    .filter(account => isForeignCurrencyAccount(account, budgetCurrency))
    .map(account => account.mc_currency as string);
  if (codes.length === 0) {
    return 0;
  }
  // The symbol and the space next to it
  return Math.max(
    ...[budgetCurrency, ...codes].map(code => mcFormat.symbol(code).length + 1),
  );
}
