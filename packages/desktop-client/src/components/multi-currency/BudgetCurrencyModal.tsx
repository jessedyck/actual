// [fork:mc D-017] Chooses the currency of a category's budget for one month.
// The budgeted amount can be converted at the month's rate or keep its
// number; spending in the budget is then counted in the new currency.
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Menu } from '@actual-app/components/menu';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import type { SelectOption } from '@actual-app/components/select';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { currencies } from '@actual-app/core/shared/currencies';
import * as monthUtils from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import type { CategoryEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useAccounts } from '#hooks/useAccounts';
import { useCategory } from '#hooks/useCategory';
import { useLocale } from '#hooks/useLocale';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';
import { useQuery } from '#hooks/useQuery';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { mcErrorMessage } from '#util/mcErrorMessage';

import { useBudgetCurrencyLookup } from './McBudgetCurrencies';

type BudgetCurrencyModalProps = {
  month: string;
  categoryId: CategoryEntity['id'];
};

type BudgetRow = { amount: number | null; mc_currency: string | null };

/** The "Default currency" choice in the select */
const DEFAULT = '';

export function BudgetCurrencyModal({
  month,
  categoryId,
}: BudgetCurrencyModalProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: category } = useCategory(categoryId);
  const { data: accounts = [] } = useAccounts();
  const { budgetCurrency } = useMultiCurrency();
  const mcFormat = useMultiCurrencyFormat();
  const lookup = useBudgetCurrencyLookup();
  const [budgetType] = useSyncedPref('budgetType');
  const table = budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets';
  const { data: rows } = useQuery<BudgetRow>(
    () =>
      q(table)
        .filter({
          month: parseInt(month.replace('-', '')),
          category: categoryId,
        })
        .select(['amount', 'mc_currency']),
    [table, month, categoryId],
  );
  const row = rows?.[0];
  const amount = row?.amount ?? 0;
  const stored = row?.mc_currency ?? DEFAULT;
  const current = lookup ? lookup(categoryId, month) : budgetCurrency;

  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? stored;
  const target = selected === DEFAULT ? budgetCurrency : selected;
  const isChanged = selected !== stored;
  const [converted, setConverted] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the budgeted amount would be in the new currency
  useEffect(() => {
    let isCurrent = true;
    setConverted(null);
    if (!isChanged || amount === 0 || target === current) {
      return;
    }
    void send(
      'mc-month-convert',
      { amount, month, from: current, to: target },
      { catchErrors: true },
    ).then(response => {
      if (isCurrent && !response.error) {
        setConverted(response.data);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [isChanged, amount, month, current, target]);

  // The default, then the currencies of accounts, then the rest
  const used = new Set(
    accounts
      .map(account => account.mc_currency)
      .filter(
        (code): code is string => Boolean(code) && code !== budgetCurrency,
      ),
  );
  const optionOf = (item: (typeof currencies)[number]): [string, string] => [
    item.code,
    `${item.code} - ${item.name}`,
  ];
  const options: Array<SelectOption> = [
    [DEFAULT, t('Default currency ({{code}})', { code: budgetCurrency })],
    ...(used.size > 0
      ? ([
          Menu.line,
          ...currencies.filter(item => used.has(item.code)).map(optionOf),
        ] satisfies Array<SelectOption>)
      : []),
    Menu.line,
    ...currencies
      .filter(item => item.code !== '' && !used.has(item.code))
      .map(optionOf),
  ];

  async function onSave(convert: boolean, close: () => void) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await send(
        'mc-budget-set-currency',
        {
          month,
          category: categoryId,
          currency: selected === DEFAULT ? null : selected,
          convert,
        },
        { catchErrors: true },
      );
      if (response.error) {
        setError(mcErrorMessage(response.error));
        return;
      }
      close();
    } finally {
      setIsSaving(false);
    }
  }

  const monthName = monthUtils.format(month, 'MMMM yyyy', locale);
  const name = category?.name ?? '';
  const amountNow = mcFormat.format(amount, current);
  const amountKept = mcFormat.format(amount, target);
  const amountConverted =
    converted === null ? null : mcFormat.format(converted, target);
  const needsChoice = isChanged && amount !== 0 && target !== current;

  return (
    <Modal name="mc-budget-currency">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Budget currency')} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 15, maxWidth: 520 }}>
            <Paragraph style={{ margin: 0 }}>
              {stored === DEFAULT ? (
                <Trans>
                  {{ name }} in {{ monthName }} uses the default currency,{' '}
                  {{ current }}. Its budget: {{ amountNow }}.
                </Trans>
              ) : (
                <Trans>
                  {{ name }} in {{ monthName }} is budgeted in {{ current }}:{' '}
                  {{ amountNow }}.
                </Trans>
              )}
            </Paragraph>

            <InlineField label={t('Currency')} width="100%">
              <Select
                value={selected}
                options={options}
                onChange={value => setChoice(value)}
                disabled={isSaving}
              />
            </InlineField>

            {isChanged && (
              <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
                <Trans>
                  Spending in this budget is counted in {{ target }}: amounts
                  from accounts in another currency at {{ monthName }}'s average
                  rate. Other months don't change.
                </Trans>
              </Paragraph>
            )}

            {error && <FormError>{error}</FormError>}

            <ModalButtons>
              <Button onPress={() => state.close()} isDisabled={isSaving}>
                <Trans>Cancel</Trans>
              </Button>
              {needsChoice ? (
                <>
                  <ButtonWithLoading
                    isLoading={isSaving}
                    onPress={() => void onSave(false, () => state.close())}
                    style={{ marginLeft: 10 }}
                  >
                    <Trans>Keep the number: {{ amountKept }}</Trans>
                  </ButtonWithLoading>
                  <ButtonWithLoading
                    variant="primary"
                    isLoading={isSaving}
                    isDisabled={amountConverted === null}
                    onPress={() => void onSave(true, () => state.close())}
                    style={{ marginLeft: 10 }}
                  >
                    {amountConverted === null ? (
                      <Trans>Convert</Trans>
                    ) : (
                      <Trans>Convert: {{ amountConverted }}</Trans>
                    )}
                  </ButtonWithLoading>
                </>
              ) : (
                <ButtonWithLoading
                  variant="primary"
                  isLoading={isSaving}
                  isDisabled={!isChanged}
                  onPress={() => void onSave(false, () => state.close())}
                  style={{ marginLeft: 10 }}
                >
                  <Trans>Save</Trans>
                </ButtonWithLoading>
              )}
            </ModalButtons>
          </View>
        </>
      )}
    </Modal>
  );
}
