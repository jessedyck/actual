// [fork:mc D-007] Form to enter an exchange rate by hand.
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { currencies } from '@actual-app/core/shared/currencies';
import * as monthUtils from '@actual-app/core/shared/months';

import { mcErrorMessage } from '#util/mcErrorMessage';

type AddExchangeRateFormProps = {
  budgetCurrency: string;
  defaultBase: string;
  onAdded: () => void;
};

type Message = { text: string; isError: boolean };

export function AddExchangeRateForm({
  budgetCurrency,
  defaultBase,
  onAdded,
}: AddExchangeRateFormProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState(monthUtils.currentDay());
  const [base, setBase] = useState(defaultBase);
  const [quote, setQuote] = useState(budgetCurrency);
  const [rateText, setRateText] = useState('');
  const [message, setMessage] = useState<Message | null>(null);

  const currencyOptions: Array<[string, string]> = currencies
    .filter(currency => currency.code !== '')
    .map(currency => [currency.code, currency.code]);

  async function onAdd() {
    const rate = Number(rateText.trim().replace(',', '.'));
    if (!base || !quote || base === quote) {
      setMessage({
        text: t('Choose two different currencies.'),
        isError: true,
      });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMessage({ text: t('Enter a date.'), isError: true });
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setMessage({ text: t('Enter a rate above 0.'), isError: true });
      return;
    }
    try {
      await send('mc-rate-set', { date, base, quote, rate });
      // A new rate may unblock conversions that were waiting for one
      const { updated } = await send('mc-recompute-pending');
      setRateText('');
      setMessage({
        text:
          updated > 0
            ? t('Rate saved. Converted {{count}} pending transactions.', {
                count: updated,
              })
            : t('Rate saved.'),
        isError: false,
      });
      onAdded();
    } catch (error) {
      setMessage({
        text: mcErrorMessage(error),
        isError: true,
      });
    }
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: spacing.sm,
          ...styles.smallText,
        }}
      >
        <Input
          type="date"
          aria-label={t('Rate date')}
          value={date}
          onChangeValue={setDate}
          style={{ width: 150 }}
        />
        <Text>1</Text>
        <Select
          value={base}
          defaultLabel={t('Currency')}
          options={currencyOptions}
          onChange={setBase}
        />
        <Text>=</Text>
        <Input
          aria-label={t('Rate')}
          inputMode="decimal"
          value={rateText}
          placeholder="0.65"
          onChangeValue={setRateText}
          onEnter={() => void onAdd()}
          style={{ width: 100 }}
        />
        <Select value={quote} options={currencyOptions} onChange={setQuote} />
        <Button onPress={() => void onAdd()}>
          <Trans>Add rate</Trans>
        </Button>
      </View>
      {message && (
        <Text
          style={{
            ...styles.smallText,
            color: message.isError ? theme.errorText : theme.noticeTextLight,
          }}
        >
          {message.text}
        </Text>
      )}
    </View>
  );
}
