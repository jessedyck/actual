// [fork:mc D-015] The currency supported reports are shown in: a synced
// preference, defaulting to the budget currency. It only takes effect while
// an exchange rate to it exists; otherwise reports stay in the budget
// currency.
import { createContext, useContext, useMemo } from 'react';

import { isForeignCurrencyAccount } from '@actual-app/core/shared/multi-currency';

import { useAccounts } from '#hooks/useAccounts';
import { useMcRate } from '#hooks/useMcRate';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useSyncedPref } from '#hooks/useSyncedPref';
import type { McValuationConfig } from '#reports/mcReportValuation';

export type McReportCurrency = {
  isEnabled: boolean;
  budgetCurrency: string;
  /** The chosen currency */
  displayCurrency: string;
  /** The chosen currency when it can be used, else the budget currency */
  effectiveCurrency: string;
  isRateMissing: boolean;
  setDisplayCurrency: (code: string) => void;
  /** Null while the feature is off */
  valuation: McValuationConfig | null;
};

export function useMcReportCurrency(): McReportCurrency {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const [pref, setPref] = useSyncedPref('mcReportCurrency');
  const { data: accounts = [] } = useAccounts();

  const displayCurrency = (isEnabled && pref) || budgetCurrency;
  const isOtherCurrency = displayCurrency !== budgetCurrency;
  const rate = useMcRate(
    isOtherCurrency ? budgetCurrency : '',
    isOtherCurrency ? displayCurrency : '',
  );
  const isRateMissing = isOtherCurrency && rate.status === 'missing';
  // While the rate is loading, keep the budget currency rather than flash
  // amounts in the wrong currency
  const effectiveCurrency =
    isOtherCurrency && rate.status === 'found'
      ? displayCurrency
      : budgetCurrency;

  const valuation = useMemo<McValuationConfig | null>(() => {
    if (!isEnabled) {
      return null;
    }
    const foreign = new Map(
      accounts
        .filter(account => isForeignCurrencyAccount(account, budgetCurrency))
        .map(account => [account.id, account.mc_currency as string]),
    );
    return {
      budgetCurrency,
      displayCurrency: effectiveCurrency,
      foreignCurrencyOf: accountId => foreign.get(accountId) ?? null,
    };
  }, [isEnabled, accounts, budgetCurrency, effectiveCurrency]);

  return {
    isEnabled,
    budgetCurrency,
    displayCurrency,
    effectiveCurrency,
    isRateMissing,
    setDisplayCurrency: code => setPref(code === budgetCurrency ? '' : code),
    valuation,
  };
}

export const McReportCurrencyContext = createContext<McReportCurrency | null>(
  null,
);

/** The report currency inside `McReportCurrencyProvider`, else null. */
export function useMcReportCurrencyContext(): McReportCurrency | null {
  return useContext(McReportCurrencyContext);
}
