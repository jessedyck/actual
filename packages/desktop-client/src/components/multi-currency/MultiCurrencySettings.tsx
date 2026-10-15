// [fork:mc D-007] Settings → General → Multi-currency accounts: rate
// downloads, the rate service, pending conversions, stored exchange rates
// and changing the budget currency (D-016). See fork/DEVIATIONS.md.
import { useTranslation } from 'react-i18next';

import { SettingsGroup } from '#components/settings/SettingsGroup';
import { SettingsRow } from '#components/settings/SettingsRow';
import { useMultiCurrency } from '#hooks/useMultiCurrency';

import { ExchangeRatesSetting } from './ExchangeRatesSetting';
import { PendingConversionsSetting } from './PendingConversionsSetting';
import { RateDownloadSetting } from './RateDownloadSetting';
import { RateServiceSetting } from './RateServiceSetting';
import { SwitchCurrencySetting } from './SwitchCurrencySetting';

export function MultiCurrencySettings() {
  const { t } = useTranslation();
  const { budgetCurrency } = useMultiCurrency();

  return (
    <SettingsGroup
      title={t('Multi-currency accounts')}
      description={t(
        'Accounts can use their own currency. Their amounts are converted to the budget currency with daily exchange rates. Experimental: this comes from a personal fork of Actual.',
      )}
    >
      {budgetCurrency === '' ? (
        <SettingsRow
          title={t('Choose a default currency first')}
          description={t(
            'Multi-currency accounts need a budget currency. Set the default currency above.',
          )}
        />
      ) : (
        <>
          <RateDownloadSetting />
          <RateServiceSetting />
          <PendingConversionsSetting />
          <ExchangeRatesSetting budgetCurrency={budgetCurrency} />
          <SwitchCurrencySetting />
        </>
      )}
    </SettingsGroup>
  );
}
