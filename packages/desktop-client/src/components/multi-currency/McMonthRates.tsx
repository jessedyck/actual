// [fork:mc D-017] Under a budget month's name: the rate the month converts
// other currencies at (its average so far, the final average, or a rate
// typed for it). Clicking one changes it for that month.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { Input } from '@actual-app/components/input';
import { Popover } from '@actual-app/components/popover';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { MonthRateInfo } from '@actual-app/core/server/multi-currency/month-rates';
import { getCurrency } from '@actual-app/core/shared/currencies';
import * as monthUtils from '@actual-app/core/shared/months';

import { useLocale } from '#hooks/useLocale';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { mcErrorMessage } from '#util/mcErrorMessage';

import { usePageBudgetCurrencies } from './McBudgetCurrencies';

function symbolOf(code: string): string {
  const currency = getCurrency(code);
  return currency.code === code && currency.symbol ? currency.symbol : code;
}

function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(5)));
}

/** The rates of a month; refetched when rates or budget currencies change. */
function useMonthRates(month: string): MonthRateInfo[] {
  const { isEnabled } = useMultiCurrency();
  const [ratesPref] = useSyncedPref('mcMonthRates');
  const lookup = usePageBudgetCurrencies();
  const [infos, setInfos] = useState<MonthRateInfo[]>([]);

  useEffect(() => {
    let isCurrent = true;
    if (!isEnabled) {
      setInfos([]);
      return;
    }
    void send('mc-month-rates', { month }, { catchErrors: true }).then(
      response => {
        if (isCurrent && !response.error) {
          setInfos(response.data);
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [isEnabled, month, ratesPref, lookup]);

  return infos;
}

export function McMonthRates({
  month,
  style,
}: {
  month: string;
  style?: CSSProperties;
}) {
  const infos = useMonthRates(month);
  if (infos.length === 0) {
    return null;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 1,
        ...style,
      }}
    >
      {infos.map(info => (
        <McMonthRate key={info.base} month={month} info={info} />
      ))}
    </View>
  );
}

function McMonthRate({ month, info }: { month: string; info: MonthRateInfo }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const rateText = formatRate(info.rate);
  const base = symbolOf(info.base);
  const quote = symbolOf(info.quote);
  const monthName = monthUtils.format(month, 'MMMM', locale);
  const isCurrentMonth = month >= monthUtils.currentMonth();

  async function save(rate: number | null, close: () => void) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await send(
        'mc-month-rate-set',
        { month, base: info.base, quote: info.quote, rate },
        { catchErrors: true },
      );
      if (response.error) {
        setError(mcErrorMessage(response.error));
      } else {
        close();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DialogTrigger
      onOpenChange={isOpen => {
        if (isOpen) {
          setValue(String(Number(info.rate.toPrecision(6))));
          setError(null);
        }
      }}
    >
      <Button
        variant="bare"
        aria-label={t('Exchange rate for {{month}}', { month: monthName })}
        style={{
          padding: '0 4px',
          fontSize: 11,
          fontWeight: 400,
          color: theme.pageTextSubdued,
        }}
      >
        <Trans>
          1 {{ base }} = {{ rateText }} {{ quote }}
        </Trans>
        {info.manual && (
          <Text style={{ marginLeft: 3, fontStyle: 'italic' }}>
            <Trans>(yours)</Trans>
          </Text>
        )}
      </Button>
      <Popover style={{ width: 300 }}>
        <Dialog
          aria-label={t('Exchange rate for {{month}}', { month: monthName })}
        >
          {({ close }) => (
            <View style={{ padding: 12, gap: 10 }}>
              <Text>
                {info.manual ? (
                  <Trans>
                    {{ monthName }} converts {{ base: info.base }} to{' '}
                    {{ quote: info.quote }} at the rate you entered.
                  </Trans>
                ) : isCurrentMonth && !info.final ? (
                  <Trans>
                    {{ monthName }} converts {{ base: info.base }} to{' '}
                    {{ quote: info.quote }} at the average of its daily rates so
                    far. It settles when the month ends.
                  </Trans>
                ) : (
                  <Trans>
                    {{ monthName }} converts {{ base: info.base }} to{' '}
                    {{ quote: info.quote }} at the average of its daily rates.
                  </Trans>
                )}
              </Text>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Text>1 {info.base} =</Text>
                <Input
                  aria-label={t('Rate')}
                  value={value}
                  onChangeValue={setValue}
                  onEnter={() => {
                    const rate = Number(value.replace(',', '.'));
                    void save(rate, close);
                  }}
                  style={{ width: 100 }}
                />
                <Text>{info.quote}</Text>
              </View>
              {error && <FormError>{error}</FormError>}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  gap: 8,
                }}
              >
                {info.manual && (
                  <Button
                    isDisabled={isSaving}
                    onPress={() => void save(null, close)}
                  >
                    <Trans>Use the average</Trans>
                  </Button>
                )}
                <Button
                  variant="primary"
                  isDisabled={
                    isSaving || !(Number(value.replace(',', '.')) > 0)
                  }
                  onPress={() =>
                    void save(Number(value.replace(',', '.')), close)
                  }
                >
                  <Trans>Use this rate</Trans>
                </Button>
              </View>
            </View>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
