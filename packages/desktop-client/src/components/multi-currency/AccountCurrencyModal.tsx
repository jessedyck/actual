// [fork:mc D-012] Changes the currency of an existing account. Convert
// changes every transaction's amount into the new currency (from the
// rule-template workaround's notes, otherwise at each month's rate) and
// leaves what the budget counted alone. Keep the numbers changes only the
// currency, for an account that was set up in the wrong one; what the
// budget counted is worked out again.
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { currencies } from '@actual-app/core/shared/currencies';
import * as monthUtils from '@actual-app/core/shared/months';
import { convertMinorUnits } from '@actual-app/core/shared/multi-currency';
import type { AccountEntity } from '@actual-app/core/types/models';
import { useQueryClient } from '@tanstack/react-query';

import { accountQueries } from '#accounts';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useAccount } from '#hooks/useAccount';
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';
import { useSheetValue } from '#hooks/useSheetValue';
import * as bindings from '#spreadsheet/bindings';
import { mcErrorMessage } from '#util/mcErrorMessage';

type AccountCurrencyModalProps = {
  accountId: AccountEntity['id'];
};

type Result = { updated: number; missingRates: number };

export function AccountCurrencyModal({ accountId }: AccountCurrencyModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const account = useAccount(accountId);
  const { budgetCurrency: defaultCurrency } = useMultiCurrency();
  const mcFormat = useMultiCurrencyFormat();
  const fromCurrency = account?.mc_currency || defaultCurrency;
  const [currency, setCurrency] = useState(fromCurrency);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The account's balance in its currency, for the two examples
  const defaultBalance = useSheetValue<'account', 'balance'>(
    bindings.accountBalance(accountId),
  );
  const ownBalance = useMcAccountBalance(
    account?.mc_currency ? accountId : null,
  )?.balance;
  const balance = account?.mc_currency ? ownBalance : defaultBalance;
  const isChanged = currency !== fromCurrency;
  const [converted, setConverted] = useState<number | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setConverted(null);
    if (!isChanged || balance == null) {
      return;
    }
    void send(
      'mc-convert',
      {
        amount: balance,
        date: monthUtils.currentDay(),
        from: fromCurrency,
        to: currency,
      },
      { catchErrors: true },
    ).then(response => {
      if (isCurrent && !response.error) {
        setConverted(response.data);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [isChanged, balance, fromCurrency, currency]);

  const options: Array<[string, string]> = currencies
    .filter(item => item.code !== '')
    .map(item => [
      item.code,
      item.code === fromCurrency
        ? t('{{code}} - {{name}} (current)', {
            code: item.code,
            name: item.name,
          })
        : item.code === defaultCurrency
          ? t('{{code}} - {{name}} (default currency)', {
              code: item.code,
              name: item.name,
            })
          : `${item.code} - ${item.name}`,
    ]);

  const name = account?.name ?? '';
  const balanceNow =
    balance == null ? '' : mcFormat.format(balance, fromCurrency);
  const balanceKept =
    balance == null
      ? ''
      : mcFormat.format(
          convertMinorUnits(balance, 1, fromCurrency, currency),
          currency,
        );
  const balanceConverted =
    converted == null ? null : mcFormat.format(converted, currency);

  async function onSave(convert: boolean, close: () => void) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await send(
        'mc-account-set-currency',
        {
          id: accountId,
          currency: currency === defaultCurrency ? null : currency,
          convert,
        },
        { catchErrors: true },
      );
      if (response.error) {
        setError(mcErrorMessage(response.error));
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: accountQueries.lists(),
      });
      if (response.data.missingRates === 0) {
        close();
      } else {
        setResult(response.data);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal name="mc-account-currency">
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle title={t('Account currency')} shrinkOnOverflow />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 15, maxWidth: 560 }}>
            <Paragraph style={{ margin: 0 }}>
              {balance == null ? (
                <Trans>
                  "{{ name }}" is in {{ fromCurrency }}.
                </Trans>
              ) : (
                <Trans>
                  "{{ name }}" is in {{ fromCurrency }}. Its balance:{' '}
                  {{ balanceNow }}.
                </Trans>
              )}
            </Paragraph>

            <InlineField
              label={t('New currency')}
              labelWidth={110}
              width="100%"
            >
              <Select
                value={currency}
                options={options}
                onChange={value => {
                  setCurrency(value);
                  setResult(null);
                }}
                disabled={isSaving || result !== null}
              />
            </InlineField>

            {isChanged && !result && (
              <View style={{ gap: 8 }}>
                <Paragraph style={{ margin: 0 }}>
                  <Trans>
                    <strong>Convert</strong> changes every transaction's amount
                    to {{ currency }}, at its month's rate, or from its note
                    where the rule-template workaround wrote one. What your
                    budget counted for them stays the same. Use it when the
                    money really is in {{ currency }} now.
                  </Trans>
                  {balanceConverted != null && (
                    <>
                      {' '}
                      <Trans>
                        The balance becomes about {{ balanceConverted }}.
                      </Trans>
                    </>
                  )}
                </Paragraph>
                <Paragraph style={{ margin: 0 }}>
                  <Trans>
                    <strong>Keep the numbers</strong> changes only the currency:
                    every amount keeps its number, now in {{ currency }}, and
                    what your budget counted for it is worked out again. Use it
                    when the account was set up in the wrong currency. Transfers
                    stay matched to the other account.
                  </Trans>
                  {balance != null && (
                    <>
                      {' '}
                      <Trans>The balance becomes {{ balanceKept }}.</Trans>
                    </>
                  )}
                </Paragraph>
              </View>
            )}

            {result && (
              <Paragraph style={{ margin: 0, color: theme.warningText }}>
                <Trans count={result.missingRates}>
                  Done. {{ count: result.missingRates }} transactions had no
                  exchange rate yet. Their amounts are filled in once a rate is
                  available (Settings → Multi-currency accounts → Budget values
                  waiting for a rate).
                </Trans>
              </Paragraph>
            )}
            {error && <FormError>{error}</FormError>}

            <ModalButtons>
              <Button onPress={() => state.close()}>
                {result ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
              </Button>
              {!result && (
                <>
                  <ButtonWithLoading
                    isLoading={isSaving}
                    isDisabled={!isChanged || !account}
                    onPress={() => void onSave(false, () => state.close())}
                    style={{ marginLeft: 10 }}
                  >
                    <Trans>Keep the numbers</Trans>
                  </ButtonWithLoading>
                  <ButtonWithLoading
                    variant="primary"
                    isLoading={isSaving}
                    isDisabled={!isChanged || !account}
                    onPress={() => void onSave(true, () => state.close())}
                    style={{ marginLeft: 10 }}
                  >
                    <Trans>Convert</Trans>
                  </ButtonWithLoading>
                </>
              )}
            </ModalButtons>
          </View>
        </>
      )}
    </Modal>
  );
}
