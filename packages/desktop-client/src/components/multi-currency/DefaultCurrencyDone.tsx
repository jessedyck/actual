// [fork:mc D-017] What changing the default currency did.
import { Trans } from 'react-i18next';

import { Paragraph } from '@actual-app/components/paragraph';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  DefaultCurrencyPreview,
  DefaultCurrencyResult,
} from '@actual-app/core/server/multi-currency/default-currency';
import * as monthUtils from '@actual-app/core/shared/months';

import { useLocale } from '#hooks/useLocale';

type DefaultCurrencyDoneProps = {
  result: DefaultCurrencyResult;
  preview: DefaultCurrencyPreview;
  keptBudgets: boolean;
};

export function DefaultCurrencyDone({
  result,
  preview,
  keptBudgets,
}: DefaultCurrencyDoneProps) {
  const locale = useLocale();
  const { fromCurrency, toCurrency } = preview;
  const keepUntil = monthUtils.format(preview.keepUntil, 'MMMM yyyy', locale);
  return (
    <View style={{ gap: 10 }}>
      <Paragraph style={{ margin: 0 }}>
        <Trans>Done: the default currency is now {{ toCurrency }}.</Trans>
      </Paragraph>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {keptBudgets && (
          <li>
            <Trans>
              Budgets without a currency of their own stay in {{ fromCurrency }}{' '}
              up to {{ keepUntil }}.
            </Trans>
          </li>
        )}
        <li>
          <Trans>Accounts updated: {{ accounts: result.accounts }}</Trans>
        </li>
        <li>
          <Trans>
            Transactions with a new value in {{ toCurrency }}:{' '}
            {{ transactions: result.transactions }}
          </Trans>
        </li>
        {result.rules > 0 && (
          <li>
            <Trans>
              Rules and schedules converted: {{ rules: result.rules }}
            </Trans>
          </li>
        )}
        {result.deletedRules > 0 && (
          <li>
            <Trans>
              Workaround rules deleted: {{ deleted: result.deletedRules }}
            </Trans>
          </li>
        )}
      </ul>
      <Paragraph style={{ margin: 0, color: theme.pageTextSubdued }}>
        <Trans>
          Ctrl+Z (or Cmd+Z) undoes the change until you reload the page.
        </Trans>
      </Paragraph>
    </View>
  );
}
