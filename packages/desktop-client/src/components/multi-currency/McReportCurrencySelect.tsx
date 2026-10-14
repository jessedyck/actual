// [fork:mc D-015] Picks the currency a supported report is shown in. The
// choice is shared by every supported report and dashboard card.
import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currencies } from '@actual-app/core/shared/currencies';

import { useAccounts } from '#hooks/useAccounts';
import { useMcReportCurrencyContext } from '#hooks/useMcReportCurrency';

export function McReportCurrencySelect({
  style,
}: {
  style?: CSSProperties;
} = {}) {
  const { t } = useTranslation();
  const reportCurrency = useMcReportCurrencyContext();
  const { data: accounts = [] } = useAccounts();

  if (!reportCurrency?.isEnabled) {
    return null;
  }
  const { budgetCurrency, displayCurrency, isRateMissing } = reportCurrency;

  // The budget currency, then the accounts' currencies, then the rest
  const used = new Set(
    accounts
      .map(account => account.mc_currency)
      .filter((code): code is string => Boolean(code)),
  );
  const rank = (code: string) =>
    code === budgetCurrency ? 0 : used.has(code) ? 1 : 2;
  const options: Array<[string, string]> = currencies
    .filter(item => item.code !== '')
    .sort((a, b) => rank(a.code) - rank(b.code))
    .map(item => [
      item.code,
      item.code === budgetCurrency
        ? t('{{code}} (budget currency)', { code: item.code })
        : `${item.code} - ${item.name}`,
    ]);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, ...style }}
    >
      <Select
        value={displayCurrency}
        options={options}
        onChange={reportCurrency.setDisplayCurrency}
      />
      {isRateMissing && (
        <Text
          style={{ color: theme.warningText }}
          title={t(
            'No exchange rate to {{code}} is available, so the report stays in {{budgetCurrency}}.',
            { code: displayCurrency, budgetCurrency },
          )}
        >
          <Trans>No rate</Trans>
        </Text>
      )}
    </View>
  );
}
