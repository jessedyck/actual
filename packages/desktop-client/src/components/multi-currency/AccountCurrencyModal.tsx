// [fork:mc D-012] Changes the currency of an existing account. Existing
// transactions get an amount in the new currency (from the rule-template
// workaround's notes, otherwise converted at each transaction's date); their
// budget amounts never change.
import { useState } from 'react';
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
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { mcErrorMessage } from '#util/mcErrorMessage';

type AccountCurrencyModalProps = {
  accountId: AccountEntity['id'];
};

type Result = { updated: number; missingRates: number };

export function AccountCurrencyModal({ accountId }: AccountCurrencyModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const account = useAccount(accountId);
  const { budgetCurrency } = useMultiCurrency();
  const currentCurrency = account?.mc_currency || budgetCurrency;
  const [currency, setCurrency] = useState(currentCurrency);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options: Array<[string, string]> = currencies
    .filter(item => item.code !== '')
    .map(item => [
      item.code,
      item.code === budgetCurrency
        ? t('{{code}} - {{name}} (budget currency)', {
            code: item.code,
            name: item.name,
          })
        : `${item.code} - ${item.name}`,
    ]);

  const isChanged = currency !== currentCurrency;
  const isToBudgetCurrency = currency === budgetCurrency;

  async function onSave(close: () => void) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await send('mc-account-set-currency', {
        id: accountId,
        currency: isToBudgetCurrency ? null : currency,
      });
      await queryClient.invalidateQueries({
        queryKey: accountQueries.lists(),
      });
      if (response.missingRates === 0) {
        close();
      } else {
        setResult(response);
      }
    } catch (saveError) {
      setError(mcErrorMessage(saveError));
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
          <View style={{ gap: 15, maxWidth: 520 }}>
            <Paragraph style={{ margin: 0 }}>
              <Trans>
                The currency of "{{ name: account?.name ?? '' }}". Your budget
                stays in {{ budgetCurrency }}.
              </Trans>
            </Paragraph>

            <InlineField label={t('Currency')} width="100%">
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
              <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
                {isToBudgetCurrency ? (
                  <Trans>
                    The amounts in {{ currentCurrency }} are removed from this
                    account's transactions. Their budget amounts don't change.
                  </Trans>
                ) : (
                  <Trans>
                    Each existing transaction gets an amount in {{ currency }}:
                    taken from its notes when they were written by the
                    rule-template workaround, otherwise converted from its
                    budget amount at that day's exchange rate. Budget amounts
                    don't change.
                  </Trans>
                )}
              </Paragraph>
            )}

            {result && (
              <Paragraph style={{ margin: 0, color: theme.warningText }}>
                <Trans count={result.missingRates}>
                  Done. {{ count: result.missingRates }} transactions had no
                  exchange rate yet. They are converted once a rate is available
                  (Settings → Multi-currency accounts → Pending conversions).
                </Trans>
              </Paragraph>
            )}
            {error && <FormError>{error}</FormError>}

            <ModalButtons>
              <Button onPress={() => state.close()}>
                {result ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
              </Button>
              {!result && (
                <ButtonWithLoading
                  variant="primary"
                  isLoading={isSaving}
                  isDisabled={!isChanged || !account}
                  onPress={() => void onSave(() => state.close())}
                  style={{ marginLeft: 10 }}
                >
                  <Trans>Change currency</Trans>
                </ButtonWithLoading>
              )}
            </ModalButtons>
          </View>
        </>
      )}
    </Modal>
  );
}
