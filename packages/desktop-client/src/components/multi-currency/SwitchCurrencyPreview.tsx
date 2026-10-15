// [fork:mc D-016] The change-budget-currency preview: today's rate, the
// currency of each account afterwards, and what else is converted.
import { Trans } from 'react-i18next';

import { Paragraph } from '@actual-app/components/paragraph';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { SwitchPreview } from '@actual-app/core/server/multi-currency/switch';

import { SwitchCurrencyAccountDetails } from './SwitchCurrencyAccountDetails';

function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(6)));
}

type SwitchCurrencyPreviewProps = {
  preview: SwitchPreview;
  accountCurrencies: Record<string, string>;
  accountOptions: Array<[string, string]>;
  isDisabled: boolean;
  onChangeAccount: (id: string, code: string) => void;
};

export function SwitchCurrencyPreview({
  preview,
  accountCurrencies,
  accountOptions,
  isDisabled,
  onChangeAccount,
}: SwitchCurrencyPreviewProps) {
  const { fromCurrency, toCurrency, workaroundRules } = preview;
  const rate =
    preview.todayRate === null ? null : formatRate(preview.todayRate);
  const workaroundAccounts = [
    ...new Set(workaroundRules.flatMap(rule => rule.accounts)),
  ].join(', ');

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
        <Text style={{ fontWeight: 600 }}>
          <Trans>Accounts</Trans>
        </Text>
        <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
          <Trans>
            The currency each account holds after the change. Accounts kept in{' '}
            {{ fromCurrency }} still show their amounts in {{ fromCurrency }}.
            An account that changes currency takes its amounts from notes
            written by the rule-template workaround, or converts them at each
            day's rate.
          </Trans>
        </Paragraph>
        <View>
          {preview.accounts.map(account => (
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
                <Text style={{ fontWeight: 500 }}>{account.name}</Text>
                <SwitchCurrencyAccountDetails
                  account={account}
                  fromCurrency={fromCurrency}
                />
              </View>
              <Select
                aria-label={account.name}
                value={accountCurrencies[account.id] ?? account.suggested}
                options={accountOptions}
                onChange={code => onChangeAccount(account.id, code)}
                disabled={isDisabled}
                style={{ minWidth: 220 }}
              />
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Also changed</Trans>
        </Text>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Trans>
              Transactions: {{ transactions: preview.transactions }}, each
              converted at its own date's rate.
            </Trans>
          </li>
          {preview.budgetMonths > 0 && (
            <li>
              <Trans>
                Budget months: {{ months: preview.budgetMonths }}. Budgets,
                goals and held money are converted at each month's average rate.
              </Trans>
            </li>
          )}
          {preview.rulesWithAmounts > 0 && (
            <li>
              <Trans>
                Rules and schedules with amounts:{' '}
                {{ rules: preview.rulesWithAmounts }}, converted at today's
                rate.
              </Trans>
            </li>
          )}
          {workaroundRules.length > 0 && (
            <li>
              <Trans>
                Rules written for the rule-template workaround:{' '}
                {{ rules: workaroundRules.length }} ({{ workaroundAccounts }}).
                They are deleted, because they would convert amounts a second
                time.
              </Trans>
            </li>
          )}
          <li>
            <Trans>
              The number format and symbol position change to the defaults for{' '}
              {{ toCurrency }}. You can adjust them under Currency.
            </Trans>
          </li>
          <li>
            <Trans>
              Budget templates, saved filters and report filters keep their
              amounts.
            </Trans>
          </li>
        </ul>
      </View>
    </View>
  );
}
