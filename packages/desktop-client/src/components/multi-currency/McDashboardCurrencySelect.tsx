// [fork:mc D-015] The dashboard's currency: one choice for every card that
// can be shown in another currency (the same one the reports use).
import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useMultiCurrency } from '#hooks/useMultiCurrency';

import { McReportCurrencyProvider } from './McReportCurrencyProvider';
import { McReportCurrencySelect } from './McReportCurrencySelect';

export function McDashboardCurrencySelect() {
  const { t } = useTranslation();
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  if (!isEnabled) {
    return null;
  }
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
      title={t(
        'Cards are shown in this currency, except budget analysis, Sankey, crossover, age of money and forecast cards, which stay in {{budgetCurrency}}.',
        { budgetCurrency },
      )}
    >
      <Text style={{ color: theme.pageTextSubdued }}>
        <Trans>Currency:</Trans>
      </Text>
      <McReportCurrencyProvider>
        <McReportCurrencySelect />
      </McReportCurrencyProvider>
    </View>
  );
}
