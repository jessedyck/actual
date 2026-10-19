// [fork:mc D-017] What changing the default currency will do: whether past
// budgets and the accounts without a currency get the old one stored on
// them, with the same numbers, and what else changes.
import { Trans, useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import type { SelectOption } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { DefaultCurrencyPreview as Preview } from '@actual-app/core/server/multi-currency/default-currency';
import { currencies } from '@actual-app/core/shared/currencies';
import * as monthUtils from '@actual-app/core/shared/months';

import { Checkbox } from '#components/forms';
import { useLocale } from '#hooks/useLocale';

import { DefaultCurrencyAccountDetails } from './DefaultCurrencyAccountDetails';

/** Choice for an account that follows the new default currency */
export const FOLLOW_DEFAULT = '';

function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(6)));
}

/** Each account without a currency: the one it most likely holds */
export function suggestedChoices(preview: Preview): Record<string, string> {
  return Object.fromEntries(
    preview.accounts
      .filter(account => !account.currency)
      .map(account => [account.id, account.suggested]),
  );
}

type DefaultCurrencyPreviewProps = {
  preview: Preview;
  keepBudgets: boolean;
  accountChoices: Record<string, string>;
  isDisabled: boolean;
  onChangeKeepBudgets: (keep: boolean) => void;
  onChangeAccountChoices: (choices: Record<string, string>) => void;
};

export function DefaultCurrencyPreview({
  preview,
  keepBudgets,
  accountChoices,
  isDisabled,
  onChangeKeepBudgets,
  onChangeAccountChoices,
}: DefaultCurrencyPreviewProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { fromCurrency, toCurrency } = preview;
  const keepFrom = monthUtils.format(preview.keepFrom, 'MMMM yyyy', locale);
  const keepUntil = monthUtils.format(preview.keepUntil, 'MMMM yyyy', locale);
  const nextMonth = monthUtils.format(
    monthUtils.nextMonth(preview.keepUntil),
    'MMMM yyyy',
    locale,
  );
  const rate =
    preview.todayRate === null ? null : formatRate(preview.todayRate);
  const withoutCurrency = preview.accounts.filter(account => !account.currency);
  const withCurrency = preview.accounts.filter(account => account.currency);
  const choiceOf = (id: string) => accountChoices[id] ?? FOLLOW_DEFAULT;
  const isKeepingAccounts =
    withoutCurrency.length > 0 &&
    withoutCurrency.every(account => choiceOf(account.id) !== FOLLOW_DEFAULT);

  const deletedRules = preview.workaroundRules.filter(
    rule =>
      rule.accountIds.length > 0 &&
      rule.accountIds.every(id => {
        const account = preview.accounts.find(item => item.id === id);
        const after =
          account?.currency ??
          (choiceOf(id) === FOLLOW_DEFAULT ? toCurrency : choiceOf(id));
        return after !== fromCurrency;
      }),
  );
  const deletedAccounts = [
    ...new Set(deletedRules.flatMap(rule => rule.accounts)),
  ].join(', ');

  const nameOf = (code: string) =>
    currencies.find(item => item.code === code)?.name ?? code;
  const accountOptions: Array<SelectOption> = [
    [
      FOLLOW_DEFAULT,
      t('Follow the default: same numbers, read as {{toCurrency}}', {
        toCurrency,
      }),
    ],
    Menu.line,
    [
      fromCurrency,
      t('{{code}} - {{name}} (same amounts)', {
        code: fromCurrency,
        name: nameOf(fromCurrency),
      }),
    ],
    [
      toCurrency,
      t('{{code}} - {{name}} (converted)', {
        code: toCurrency,
        name: nameOf(toCurrency),
      }),
    ],
    Menu.line,
    ...currencies
      .filter(
        item =>
          item.code !== '' &&
          item.code !== fromCurrency &&
          item.code !== toCurrency,
      )
      .map((item): [string, string] => [
        item.code,
        `${item.code} - ${item.name}`,
      ]),
  ];

  return (
    <View style={{ gap: 15 }}>
      {rate === null ? (
        <Text style={{ color: theme.warningText }}>
          <Trans>
            No {{ fromCurrency }} to {{ toCurrency }} exchange rate is available
            yet. Turn on automatic rate downloads, or add rates under Exchange
            rates.
          </Trans>
        </Text>
      ) : (
        <Text>
          <Trans>
            Today, 1 {{ fromCurrency }} = {{ rate }} {{ toCurrency }}.
          </Trans>
        </Text>
      )}

      <View style={{ gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <Checkbox
            id="mc-default-keep-budgets"
            checked={keepBudgets}
            disabled={isDisabled}
            onChange={event => onChangeKeepBudgets(event.target.checked)}
          />
          <label
            htmlFor="mc-default-keep-budgets"
            style={{ userSelect: 'none', fontWeight: 600 }}
          >
            <Trans>
              Set budgets up to {{ keepUntil }} to {{ fromCurrency }}, with the
              same numbers
            </Trans>
          </label>
        </View>
        <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
          {keepBudgets ? (
            <Trans>
              Every category's budget from {{ keepFrom }} to {{ keepUntil }}{' '}
              without a currency of its own gets {{ fromCurrency }} stored with
              it. Its numbers and what it counted don't change, and later
              changes of the default currency leave it alone. From{' '}
              {{ nextMonth }}, budgets without a currency of their own are in{' '}
              {{ toCurrency }}.
            </Trans>
          ) : (
            <Trans>
              They change to {{ toCurrency }} with the same numbers, past months
              included.
            </Trans>
          )}
        </Paragraph>
      </View>

      {withoutCurrency.length > 0 && (
        <View style={{ gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Checkbox
              id="mc-default-keep-accounts"
              checked={isKeepingAccounts}
              disabled={isDisabled}
              onChange={event =>
                onChangeAccountChoices(
                  event.target.checked
                    ? suggestedChoices(preview)
                    : Object.fromEntries(
                        withoutCurrency.map(account => [
                          account.id,
                          FOLLOW_DEFAULT,
                        ]),
                      ),
                )
              }
            />
            <label
              htmlFor="mc-default-keep-accounts"
              style={{ userSelect: 'none', fontWeight: 600 }}
            >
              <Trans count={withoutCurrency.length}>
                Set accounts without a currency of their own to{' '}
                {{ fromCurrency }}, with the same amounts (
                {{ count: withoutCurrency.length }})
              </Trans>
            </label>
          </View>
          <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
            <Trans>
              This updates every transaction in these accounts: each keeps its
              amount and gets {{ fromCurrency }} stored with it, so later
              changes of the default currency leave it alone. You can choose
              differently for an account below: follow the default (same
              numbers, read as {{ toCurrency }}), or another currency (amounts
              from notes written by the rule-template workaround, or converted
              at each month's rate).
            </Trans>
          </Paragraph>
          <View>
            {withoutCurrency.map(account => (
              <View
                key={account.id}
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 0',
                  borderBottom: `1px solid ${theme.tableBorder}`,
                }}
              >
                <View style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <label
                    htmlFor={`mc-default-account-${account.id}`}
                    style={{ fontWeight: 500 }}
                  >
                    {account.name}
                  </label>
                  <DefaultCurrencyAccountDetails account={account} />
                </View>
                <Select
                  id={`mc-default-account-${account.id}`}
                  value={choiceOf(account.id)}
                  options={accountOptions}
                  onChange={choice =>
                    onChangeAccountChoices({
                      ...accountChoices,
                      [account.id]: choice,
                    })
                  }
                  disabled={isDisabled}
                  style={{ minWidth: 240 }}
                />
              </View>
            ))}
          </View>
        </View>
      )}

      {withCurrency.length > 0 && (
        <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
          <Trans>
            Accounts with a currency of their own keep it:{' '}
            {{
              accounts: withCurrency
                .map(account => `${account.name} (${account.currency})`)
                .join(', '),
            }}
            .
          </Trans>
        </Paragraph>
      )}

      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Also</Trans>
        </Text>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Trans>
              To Budget, group totals and reports switch to {{ toCurrency }}.
              Each transaction's value in {{ toCurrency }} is worked out at its
              month's average rate; the amounts in your accounts don't change.
            </Trans>
          </li>
          {deletedRules.length > 0 && (
            <li>
              <Trans>
                Rules written for the rule-template workaround (
                {{ deletedAccounts }}) are deleted: they would convert amounts
                into {{ fromCurrency }}.
              </Trans>
            </li>
          )}
          <li>
            <Trans>
              The number format and symbol position change to the defaults for{' '}
              {{ toCurrency }}. You can adjust them under Currency.
            </Trans>
          </li>
        </ul>
      </View>
    </View>
  );
}
