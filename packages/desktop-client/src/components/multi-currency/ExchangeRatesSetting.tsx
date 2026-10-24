// [fork:mc D-007] Lists stored exchange rates and adds manual ones.
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { McExchangeRateEntity } from '@actual-app/core/types/models';

import { SettingsRow } from '#components/settings/SettingsRow';
import { useAccounts } from '#hooks/useAccounts';

import { AddExchangeRateForm } from './AddExchangeRateForm';

const RATES_SHOWN = 50;

function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(6)));
}

type ExchangeRatesSettingProps = {
  budgetCurrency: string;
};

export function ExchangeRatesSetting({
  budgetCurrency,
}: ExchangeRatesSettingProps) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const [rates, setRates] = useState<McExchangeRateEntity[] | null>(null);
  const [version, setVersion] = useState(0);

  const accountCurrencies = [
    ...new Set(
      accounts
        .map(account => account.mc_currency)
        .filter(
          (code): code is string => Boolean(code) && code !== budgetCurrency,
        ),
    ),
  ];

  useEffect(() => {
    let isCurrent = true;
    void send('mc-rates-list', { limit: RATES_SHOWN }).then(rows => {
      if (isCurrent) {
        setRates(rows);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [version]);

  async function onDelete(id: string) {
    await send('mc-rate-delete', { id });
    setVersion(v => v + 1);
  }

  return (
    <SettingsRow
      title={t('Exchange rates')}
      description={t(
        "Daily rates stored in this budget file, newest first. A rate you enter wins over a downloaded one for the same day. Each month converts at the average of its daily rates; the rate under a month's name on the budget page can be changed for that month alone.",
      )}
    >
      <AddExchangeRateForm
        budgetCurrency={budgetCurrency}
        defaultBase={accountCurrencies[0] ?? ''}
        onAdded={() => setVersion(v => v + 1)}
      />
      {rates && rates.length === 0 && (
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>No exchange rates stored yet.</Trans>
        </Text>
      )}
      {rates && rates.length > 0 && (
        <View
          role="table"
          aria-label={t('Exchange rates')}
          style={{ ...styles.smallText, maxHeight: 320, overflowY: 'auto' }}
        >
          {rates.map(rate => (
            <View
              key={rate.id}
              role="row"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                // Rows keep their height and the list scrolls
                flexShrink: 0,
                gap: spacing.md,
                padding: `${spacing.xs}px 0`,
                borderTop: `1px solid ${theme.settingsCardBorder}`,
              }}
            >
              <Text role="cell" style={{ width: 90, ...styles.tnum }}>
                {rate.date}
              </Text>
              <Text role="cell" style={{ flex: 1, ...styles.tnum }}>
                {`1 ${rate.base} = ${formatRate(rate.rate)} ${rate.quote}`}
              </Text>
              <Text
                role="cell"
                style={{ width: 90, color: theme.pageTextSubdued }}
              >
                {rate.source === 'manual' ? t('Entered') : t('Downloaded')}
              </Text>
              <Button
                variant="bare"
                aria-label={t('Delete the rate of {{date}}', {
                  date: rate.date,
                })}
                onPress={() => void onDelete(rate.id)}
              >
                <Trans>Delete</Trans>
              </Button>
            </View>
          ))}
        </View>
      )}
    </SettingsRow>
  );
}
