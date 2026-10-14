// [fork:mc D-008] Upstream's `ReconcileMenu` for a foreign-currency account:
// the statement balance is typed in the account's currency and compared with
// the account-currency cleared balance.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { hundredthsToMinorUnits } from '@actual-app/core/shared/multi-currency';
import { tsToRelativeTime } from '@actual-app/core/shared/util';
import type { AccountEntity } from '@actual-app/core/types/models';
import { format as formatDate } from 'date-fns';

import { useDateFormat } from '#hooks/useDateFormat';
import { useLocale } from '#hooks/useLocale';
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

type McReconcileMenuProps = {
  account: AccountEntity;
  currency: string;
  onReconcile: (amount: number | null) => void;
  onClose: () => void;
};

export function McReconcileMenu({
  account,
  currency,
  onReconcile,
  onClose,
}: McReconcileMenuProps) {
  const { t } = useTranslation();
  const mcFormat = useMultiCurrencyFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const balances = useMcAccountBalance(account.id);
  const clearedBalance = balances?.cleared ?? null;
  // Bank sync reports the balance the bank holds, i.e. in this currency,
  // in hundredths like every synced amount
  const lastSyncedBalance =
    account.balance_current == null
      ? null
      : hundredthsToMinorUnits(account.balance_current, currency);

  const [inputValue, setInputValue] = useState<string | null>(null);
  useEffect(() => {
    if (clearedBalance != null && inputValue == null) {
      setInputValue(mcFormat.forEdit(clearedBalance, currency));
    }
  }, [clearedBalance, currency, inputValue, mcFormat]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inputValue === '') {
      return;
    }
    const amount =
      inputValue != null
        ? (mcFormat.fromEdit(inputValue, currency) ?? clearedBalance)
        : clearedBalance;
    onReconcile(amount);
    onClose();
  }

  return (
    <Form onSubmit={onSubmit}>
      <View style={{ padding: '5px 8px' }}>
        <Text>
          <Trans>
            Enter the current balance of your bank account, in {{ currency }},
            that you want to reconcile with:
          </Trans>
        </Text>
        {inputValue != null && (
          <InitialFocus>
            <Input
              value={inputValue}
              onChangeValue={setInputValue}
              style={{ margin: '7px 0', textAlign: 'right' }}
            />
          </InitialFocus>
        )}
        {lastSyncedBalance != null && (
          <View>
            <Text style={{ margin: '0 6px 8px 0', textAlign: 'right' }}>
              <Trans>Last Balance from Bank: </Trans>
              {mcFormat.format(lastSyncedBalance, currency)}
            </Text>
            <Button
              onPress={() =>
                setInputValue(mcFormat.forEdit(lastSyncedBalance, currency))
              }
              style={{ marginBottom: 7 }}
            >
              <Trans>Use last synced total</Trans>
            </Button>
          </View>
        )}
        <Button type="submit" variant="primary">
          <Trans>Reconcile</Trans>
        </Button>
        <Text
          style={{
            color: theme.pageTextLight,
            marginTop: '8px',
            textAlign: 'center',
          }}
        >
          {account.last_reconciled
            ? t('Reconciled {{ relativeTimeAgo }} ({{ absoluteDate }})', {
                relativeTimeAgo: tsToRelativeTime(
                  account.last_reconciled,
                  locale,
                ),
                absoluteDate: formatDate(
                  new Date(parseInt(account.last_reconciled ?? '0', 10)),
                  dateFormat,
                  { locale },
                ),
              })
            : t('Not yet reconciled')}
        </Text>
      </View>
    </Form>
  );
}
