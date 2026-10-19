// [fork:mc D-018] Amounts of schedules and rules are in their account's
// currency: these format them that way when the account has its own.
import type { ReactNode } from 'react';

import { McDisplayCurrencyContext } from '#hooks/useMcDisplayCurrency';
import {
  useAccountCurrencyOf,
  useHasForeignCurrencyAccounts,
  useMultiCurrency,
} from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

/** Formats the amounts inside it in the account's currency. */
export function McAccountCurrencyFormat({
  accountId,
  children,
}: {
  accountId: string | null | undefined;
  children: ReactNode;
}) {
  const currencyOf = useAccountCurrencyOf();
  return (
    <McDisplayCurrencyContext.Provider value={currencyOf(accountId)}>
      {children}
    </McDisplayCurrencyContext.Provider>
  );
}

/** The account a rule is for, when a condition names one ("account is"). */
export function getRuleAccount(
  conditions: ReadonlyArray<{ field?: string; op?: string; value?: unknown }>,
): string | null {
  const condition = conditions.find(
    item =>
      item.field === 'account' &&
      item.op === 'is' &&
      typeof item.value === 'string',
  );
  return typeof condition?.value === 'string' ? condition.value : null;
}

/**
 * A stored transaction's amount in its account's currency when the account
 * has its own (lists of a rule's or a schedule's transactions); otherwise
 * `children`, the amount as upstream formats it.
 */
export function McTransactionAmount({
  transaction,
  children,
}: {
  transaction: { account?: string | null; mc_amount?: number | null };
  children: ReactNode;
}) {
  const currencyOf = useAccountCurrencyOf();
  const mcFormat = useMultiCurrencyFormat();
  const currency = currencyOf(transaction.account);
  if (!currency || transaction.mc_amount == null) {
    return children;
  }
  return mcFormat.format(transaction.mc_amount, currency);
}

/** An amount column's width, wider when amounts can carry a symbol (CA$). */
export function useMcAmountColumnWidth(width: number): number {
  const { isEnabled } = useMultiCurrency();
  const hasForeignAccounts = useHasForeignCurrencyAccounts();
  return isEnabled && hasForeignAccounts ? width + 35 : width;
}
