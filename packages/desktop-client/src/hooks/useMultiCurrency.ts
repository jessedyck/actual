// [fork:mc D-007] Client-side multi-currency state. Mirrors the server's
// `getMultiCurrencyContext`: the feature is on when its flag is on and a
// budget currency is set. See fork/DEVIATIONS.md.
import {
  getAccountCurrency,
  isForeignCurrencyAccount,
} from '@actual-app/core/shared/multi-currency';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useAccounts } from '#hooks/useAccounts';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useSyncedPref } from '#hooks/useSyncedPref';

export type MultiCurrencyState = {
  isEnabled: boolean;
  budgetCurrency: string;
};

export function useMultiCurrency(): MultiCurrencyState {
  const isFlagOn = useFeatureFlag('multiCurrency');
  const [defaultCurrencyCode] = useSyncedPref('defaultCurrencyCode');
  const budgetCurrency = defaultCurrencyCode || '';
  return { isEnabled: isFlagOn && budgetCurrency !== '', budgetCurrency };
}

export type AccountCurrencyState = {
  /** The account uses its own currency and the feature is on */
  isForeign: boolean;
  /** The account's currency, or the budget currency */
  currency: string;
  budgetCurrency: string;
};

type AccountWithCurrency = Pick<AccountEntity, 'mc_currency'>;

export function getAccountCurrencyState(
  account: AccountWithCurrency | null | undefined,
  { isEnabled, budgetCurrency }: MultiCurrencyState,
): AccountCurrencyState {
  const isForeign =
    isEnabled && isForeignCurrencyAccount(account, budgetCurrency);
  return {
    isForeign,
    currency: isForeign
      ? getAccountCurrency(account, budgetCurrency)
      : budgetCurrency,
    budgetCurrency,
  };
}

export function useAccountCurrency(
  account: AccountWithCurrency | null | undefined,
): AccountCurrencyState {
  return getAccountCurrencyState(account, useMultiCurrency());
}

/**
 * True when any account (open or closed) has its own currency. The budget
 * currency must not change then: existing budget amounts would be read in
 * the wrong currency.
 */
export function useHasForeignCurrencyAccounts(): boolean {
  const { data: accounts = [] } = useAccounts();
  return accounts.some(account => Boolean(account.mc_currency));
}
