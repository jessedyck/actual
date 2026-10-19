// [fork:mc D-012] Account totals (All accounts, On budget, Off budget,
// Closed) are sums in the default currency. They can also be shown in
// another currency: every account's balance in its own currency, valued at
// today's rate.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import { Select } from '@actual-app/components/select';
import type { SelectOption } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { send } from '@actual-app/core/platform/client/connection';
import type { AccountTotals } from '@actual-app/core/server/multi-currency/accounts';
import { currencies } from '@actual-app/core/shared/currencies';

import { FinancialText } from '#components/FinancialText';
import { useAccounts } from '#hooks/useAccounts';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';
import { useSheetValue } from '#hooks/useSheetValue';
import { useSyncedPref } from '#hooks/useSyncedPref';
import * as bindings from '#spreadsheet/bindings';

type TotalKind = keyof AccountTotals;

type McAccountTotalsState = {
  currency: string;
  totals: AccountTotals | null;
};

const McAccountTotalsContext = createContext<McAccountTotalsState | null>(null);

/** The currency totals are shown in: the chosen one, else the default */
function useTotalsCurrency(): [string, (code: string) => void, boolean] {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const [pref, setPref] = useSyncedPref('mcTotalsCurrency');
  const currency = (isEnabled && pref) || budgetCurrency;
  return [
    currency,
    code => setPref(code === budgetCurrency ? '' : code),
    isEnabled,
  ];
}

/** Fetches the totals in the chosen currency while it isn't the default. */
export function McAccountTotalsProvider({ children }: { children: ReactNode }) {
  const { budgetCurrency } = useMultiCurrency();
  const [currency, , isEnabled] = useTotalsCurrency();
  // Refetch when balances change
  const allBalance = useSheetValue<'account', 'accounts-balance'>(
    bindings.allAccountBalance(),
  );
  const closedBalance = useSheetValue<'account', 'closed-accounts-balance'>(
    bindings.closedAccountBalance(),
  );
  const { data: accounts = [] } = useAccounts();
  const [totals, setTotals] = useState<AccountTotals | null>(null);
  const isOther = isEnabled && currency !== budgetCurrency;

  useEffect(() => {
    let isCurrent = true;
    if (!isOther) {
      setTotals(null);
      return;
    }
    void send('mc-account-totals', { currency }, { catchErrors: true }).then(
      response => {
        if (isCurrent) {
          setTotals(response.error ? null : response.data);
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [isOther, currency, allBalance, closedBalance, accounts]);

  return (
    <McAccountTotalsContext.Provider
      value={isOther ? { currency, totals } : null}
    >
      {children}
    </McAccountTotalsContext.Provider>
  );
}

/**
 * A total in the chosen currency, or `children` (the default-currency sum)
 * while totals are shown in the default currency.
 */
export function McAccountTotal({
  kind,
  children,
}: {
  kind?: TotalKind;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const state = useContext(McAccountTotalsContext);
  const mcFormat = useMultiCurrencyFormat();
  if (!state || !kind) {
    return children;
  }
  const value = state.totals?.[kind];
  return (
    <FinancialText
      style={styles.text}
      title={t("Each account's balance at today's rate")}
    >
      {value == null ? '…' : `≈ ${mcFormat.format(value, state.currency)}`}
    </FinancialText>
  );
}

/** Picks the currency account totals are shown in. */
export function McAccountTotalsSelect() {
  const { budgetCurrency } = useMultiCurrency();
  const [currency, setCurrency, isEnabled] = useTotalsCurrency();
  const { data: accounts = [] } = useAccounts();
  if (!isEnabled) {
    return null;
  }
  // The default currency and the accounts' currencies (shown as codes, to
  // fit the header), then the rest
  const used = new Set(
    accounts
      .map(account => account.mc_currency)
      .filter(
        (code): code is string => Boolean(code) && code !== budgetCurrency,
      ),
  );
  const options: Array<SelectOption> = [
    [budgetCurrency, budgetCurrency],
    ...[...used].sort().map((code): [string, string] => [code, code]),
    Menu.line,
    ...currencies
      .filter(
        item =>
          item.code !== '' &&
          item.code !== budgetCurrency &&
          !used.has(item.code),
      )
      .map((item): [string, string] => [
        item.code,
        `${item.code} - ${item.name}`,
      ]),
  ];
  return (
    <Select
      bare
      value={currency}
      options={options}
      onChange={setCurrency}
      style={{
        margin: '0 6px',
        color: theme.mobileHeaderText,
        backgroundColor: 'transparent',
      }}
    />
  );
}
