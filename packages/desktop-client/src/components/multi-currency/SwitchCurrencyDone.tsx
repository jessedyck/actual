// [fork:mc D-016] What the budget currency change converted.
import { Trans } from 'react-i18next';

import { Paragraph } from '@actual-app/components/paragraph';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  SwitchPreview,
  SwitchResult,
} from '@actual-app/core/server/multi-currency/switch';

type SwitchCurrencyDoneProps = {
  result: SwitchResult;
  preview: SwitchPreview;
};

export function SwitchCurrencyDone({
  result,
  preview,
}: SwitchCurrencyDoneProps) {
  const { toCurrency } = preview;
  return (
    <View style={{ gap: 10 }}>
      <Paragraph style={{ margin: 0 }}>
        <Trans>Done: your budget is now in {{ toCurrency }}.</Trans>
      </Paragraph>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          <Trans>
            Transactions converted: {{ transactions: result.transactions }}
          </Trans>
        </li>
        <li>
          <Trans>Budget amounts converted: {{ budgets: result.budgets }}</Trans>
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
          Exchange rates change from day to day, so this month's amount to
          budget and some category balances can be off by a little. Adjust this
          month's budgets to bring them back.
        </Trans>
      </Paragraph>
    </View>
  );
}
