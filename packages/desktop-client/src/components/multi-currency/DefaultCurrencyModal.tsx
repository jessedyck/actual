// [fork:mc D-017] Changes the default currency: the one budgets and accounts
// without a currency of their own use, and To Budget and totals are in.
// Budgets without one can keep the old currency up to this month, and
// accounts without one can keep it as their own.
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
  DefaultCurrencyResult,
  DefaultCurrencyPreview as Preview,
} from '@actual-app/core/server/multi-currency/default-currency';
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

import { DefaultCurrencyDone } from './DefaultCurrencyDone';
import {
  DefaultCurrencyPreview,
  FOLLOW_DEFAULT,
  suggestedChoices,
} from './DefaultCurrencyPreview';

export function DefaultCurrencyModal() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const { budgetCurrency: defaultCurrency } = useMultiCurrency();
  const [toCurrency, setToCurrency] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [keepBudgets, setKeepBudgets] = useState(true);
  const [accountChoices, setAccountChoices] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<DefaultCurrencyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const currencyOptions: Array<[string, string]> = [
    ['', t('Choose a currency')],
    ...currencies
      .filter(item => item.code !== '' && item.code !== defaultCurrency)
      .map((item): [string, string] => [
        item.code,
        `${item.code} - ${item.name}`,
      ]),
  ];

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
        'mc-default-currency-preview',
        { toCurrency: code },
        { catchErrors: true },
      );
      if (request !== latestRequest.current) {
        return;
      }
      if (response.error) {
        setError(mcErrorMessage(response.error));
      } else {
        setPreview(response.data);
        setAccountChoices(suggestedChoices(response.data));
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
      // An account left out follows the new default with the same numbers
      const accountCurrencies = Object.fromEntries(
        Object.entries(accountChoices).filter(
          ([, code]) => code !== FOLLOW_DEFAULT,
        ),
      );
      const response = await send(
        'mc-default-currency-set',
        { toCurrency: preview.toCurrency, accountCurrencies, keepBudgets },
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
    <Modal
      name="mc-default-currency"
      containerProps={{ style: { width: 720 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={t('Change default currency')}
                shrinkOnOverflow
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {result && preview ? (
            <View style={{ gap: 15 }}>
              <DefaultCurrencyDone
                result={result}
                preview={preview}
                keptBudgets={keepBudgets}
              />
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
                  The default currency of this budget file is{' '}
                  {{ defaultCurrency }}. Budgets and accounts without a currency
                  of their own use it, and To Budget and totals are in it.
                  Changing it leaves budgets, accounts and transactions with a
                  currency of their own as they are.
                </Trans>
              </Paragraph>

              <InlineField
                label={t('New default')}
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
                  <Trans>Looking at your budgets, accounts and rules…</Trans>
                </Text>
              )}

              {preview && (
                <DefaultCurrencyPreview
                  preview={preview}
                  keepBudgets={keepBudgets}
                  accountChoices={accountChoices}
                  isDisabled={isApplying}
                  onChangeKeepBudgets={setKeepBudgets}
                  onChangeAccountChoices={setAccountChoices}
                />
              )}

              {preview && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Checkbox
                    id="mc-default-backup"
                    checked={hasBackup}
                    disabled={isApplying}
                    onChange={event => setHasBackup(event.target.checked)}
                  />
                  <label
                    htmlFor="mc-default-backup"
                    style={{ userSelect: 'none' }}
                  >
                    <Trans>
                      I have a backup of this budget file (Settings → Export
                      data)
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
                    <Trans>Change default currency</Trans>
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
