// [fork:mc D-007] Settings → General → Multi-currency accounts: rate
// downloads, the rate service, pending conversions, stored exchange rates
// and changing the default currency (D-017). See fork/DEVIATIONS.md.
import { useTranslation } from 'react-i18next';

import { SettingsGroup } from '#components/settings/SettingsGroup';
import { SettingsRow } from '#components/settings/SettingsRow';
import { useMultiCurrency } from '#hooks/useMultiCurrency';

import { DefaultCurrencySetting } from './DefaultCurrencySetting';
import { ExchangeRatesSetting } from './ExchangeRatesSetting';
import { PendingConversionsSetting } from './PendingConversionsSetting';
import { RateDownloadSetting } from './RateDownloadSetting';
import { RateServiceSetting } from './RateServiceSetting';

export function MultiCurrencySettings() {
  const { t } = useTranslation();
  const { budgetCurrency: defaultCurrency } = useMultiCurrency();

  return (
    <SettingsGroup
      title={t('Multi-currency accounts')}
      description={t(
        "Each account can have its own currency. Its transactions stay in that currency, as your bank recorded them. Each month's budgets count them in their own currency, {{defaultCurrency}} unless you choose another for a budget, at the month's average exchange rate. Experimental: this comes from a personal fork of Actual.",
        { defaultCurrency: defaultCurrency || t('the default currency') },
      )}
    >
      {defaultCurrency === '' ? (
        <SettingsRow
          title={t('Choose a default currency first')}
          description={t(
            'Multi-currency accounts need a default currency. Set it under Currency above.',
          )}
        />
      ) : (
        <>
          <DefaultCurrencySetting />
          <RateDownloadSetting />
          <RateServiceSetting />
          <PendingConversionsSetting />
          <ExchangeRatesSetting budgetCurrency={defaultCurrency} />
        </>
      )}
    </SettingsGroup>
  );
}
