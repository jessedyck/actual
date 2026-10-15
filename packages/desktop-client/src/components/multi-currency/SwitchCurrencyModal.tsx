// [fork:mc D-016] Moves the budget and its history to another currency.
// Shows which currency each account holds afterwards before anything
// changes: its own currency, the docs' `#currency:XXX` note or "(XXX)" name,
// or the currency of the workaround notes on its transactions.
import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type {
  SwitchPreview,
  SwitchResult,
} from '@actual-app/core/server/multi-currency/switch';
import { currencies } from '@actual-app/core/shared/currencies';
import { useQueryClient } from '@tanstack/react-query';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { Checkbox } from '#components/forms';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { loadPrefs } from '#prefs/prefsSlice';
import { useDispatch } from '#redux';
import { mcErrorMessage } from '#util/mcErrorMessage';

import { SwitchCurrencyDone } from './SwitchCurrencyDone';
import { SwitchCurrencyPreview } from './SwitchCurrencyPreview';

export function SwitchCurrencyModal() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const { budgetCurrency } = useMultiCurrency();
  const [toCurrency, setToCurrency] = useState('');
  const [preview, setPreview] = useState<SwitchPreview | null>(null);
  const [accountCurrencies, setAccountCurrencies] = useState<
    Record<string, string>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<SwitchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const currencyOptions: Array<[string, string]> = [
    ['', t('Choose a currency')],
    ...currencies
      .filter(item => item.code !== '' && item.code !== budgetCurrency)
      .map((item): [string, string] => [
        item.code,
        `${item.code} - ${item.name}`,
      ]),
  ];
  const accountOptions = (newBudgetCurrency: string): Array<[string, string]> =>
    currencies
      .filter(item => item.code !== '')
      .map(item => [
        item.code,
        item.code === newBudgetCurrency
          ? t('{{code}} - {{name}} (new budget currency)', {
              code: item.code,
              name: item.name,
            })
          : `${item.code} - ${item.name}`,
      ]);

  async function onChooseCurrency(code: string) {
    const request = ++latestRequest.current;
    setToCurrency(code);
    setPreview(null);
    setError(null);
    if (!code) {
      return;
    }
    setIsLoading(true);
    try {
      // Errors are shown here, not as the app's generic error notification
      const response = await send(
        'mc-switch-preview',
        { toCurrency: code },
        { catchErrors: true },
      );
      if (request !== latestRequest.current) {
        return;
      }
      if (response.error) {
        setError(mcErrorMessage(response.error));
      } else {
        const data = response.data;
        setPreview(data);
        setAccountCurrencies(
          Object.fromEntries(
            data.accounts.map(account => [account.id, account.suggested]),
          ),
        );
      }
    } finally {
      if (request === latestRequest.current) {
        setIsLoading(false);
      }
    }
  }

  async function onApply() {
    if (!preview) {
      return;
    }
    setIsApplying(true);
    setError(null);
    try {
      const response = await send(
        'mc-switch-apply',
        { toCurrency: preview.toCurrency, accountCurrencies },
        { catchErrors: true },
      );
      if (response.error) {
        setError(mcErrorMessage(response.error));
        return;
      }
      setResult(response.data);
      await dispatch(loadPrefs());
      await queryClient.invalidateQueries();
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <Modal name="mc-switch-currency" containerProps={{ style: { width: 720 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={t('Change budget currency')}
                shrinkOnOverflow
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {result && preview ? (
            <View style={{ gap: 15 }}>
              <SwitchCurrencyDone result={result} preview={preview} />
              <ModalButtons>
                <Button variant="primary" onPress={() => state.close()}>
                  <Trans>Close</Trans>
                </Button>
              </ModalButtons>
            </View>
          ) : (
            <View style={{ gap: 15 }}>
              <Paragraph style={{ margin: 0 }}>
                <Trans>
                  Your budget is in {{ budgetCurrency }}. Choose its new
                  currency: the whole history moves with it. Each transaction is
                  converted at its own date's exchange rate and each month's
                  budget at that month's average rate.
                </Trans>
              </Paragraph>

              <InlineField
                label={t('New currency')}
                labelWidth={110}
                width="100%"
              >
                <Select
                  value={toCurrency}
                  options={currencyOptions}
                  onChange={code => void onChooseCurrency(code)}
                  disabled={isApplying}
                />
              </InlineField>

              {isLoading && (
                <Text style={{ color: theme.pageTextSubdued }}>
                  <Trans>Looking at your accounts and rules…</Trans>
                </Text>
              )}

              {preview && (
                <SwitchCurrencyPreview
                  preview={preview}
                  accountCurrencies={accountCurrencies}
                  accountOptions={accountOptions(preview.toCurrency)}
                  isDisabled={isApplying}
                  onChangeAccount={(id, code) =>
                    setAccountCurrencies(current => ({
                      ...current,
                      [id]: code,
                    }))
                  }
                />
              )}

              {preview && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Checkbox
                    id="mc-switch-backup"
                    checked={hasBackup}
                    disabled={isApplying}
                    onChange={event => setHasBackup(event.target.checked)}
                  />
                  <label
                    htmlFor="mc-switch-backup"
                    style={{ userSelect: 'none' }}
                  >
                    <Trans>
                      I have a backup of this budget (Settings → Export data)
                    </Trans>
                  </label>
                </View>
              )}

              {error && <FormError>{error}</FormError>}

              <ModalButtons>
                <Button onPress={() => state.close()} isDisabled={isApplying}>
                  <Trans>Cancel</Trans>
                </Button>
                <ButtonWithLoading
                  variant="primary"
                  isLoading={isApplying}
                  isDisabled={!preview || !hasBackup}
                  onPress={() => void onApply()}
                  style={{ marginLeft: 10 }}
                >
                  {preview ? (
                    <Trans>
                      Change to {{ toCurrency: preview.toCurrency }}
                    </Trans>
                  ) : (
                    <Trans>Change currency</Trans>
                  )}
                </ButtonWithLoading>
              </ModalButtons>
            </View>
          )}
        </>
      )}
    </Modal>
  );
}
