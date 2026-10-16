// [fork:mc D-012] Explains a foreign-currency account's header amounts with
// its own numbers: the balance in its currency, what it is worth today, what
// the budget has counted for it, and why the last two differ.
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgInformationOutline } from '@actual-app/components/icons/v1';
import { Popover } from '@actual-app/components/popover';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { TransObjectLiteral } from '@actual-app/core/types/util';

import { useFormat } from '#hooks/useFormat';
import type { McRateState } from '#hooks/useMcRate';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

type McBalancesHelpProps = {
  currency: string;
  budgetCurrency: string;
  /** The balance in the account's currency */
  balance: number;
  /** That balance at today's rate, in the budget currency */
  worthToday: number | null;
  /** What the budget counts for the account */
  budgetValue: number;
  rate: McRateState;
};

export function McBalancesHelp({
  currency,
  budgetCurrency,
  balance,
  worthToday,
  budgetValue,
  rate,
}: McBalancesHelpProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const mcFormat = useMultiCurrencyFormat();
  const accountBalance = mcFormat.format(balance, currency);
  const inBudget = format(budgetValue, 'financial');
  const worth = worthToday === null ? null : format(worthToday, 'financial');
  const difference =
    worthToday === null ? 0 : Math.abs(worthToday - budgetValue);
  const gap = format(difference, 'financial');
  const rateText =
    rate.status === 'found'
      ? `1 ${currency} = ${Number(rate.rate.toPrecision(6))} ${budgetCurrency}`
      : null;

  return (
    <DialogTrigger>
      <Button
        variant="bare"
        aria-label={t('How these amounts work')}
        style={{ padding: 4, color: theme.pageTextSubdued }}
      >
        <SvgInformationOutline style={{ width: 14, height: 14 }} />
      </Button>
      <Popover style={{ width: 360 }}>
        <Dialog aria-label={t('How these amounts work')}>
          <View style={{ padding: 14, gap: 10 }}>
            <Text>
              <Trans>
                <strong>{{ accountBalance } as TransObjectLiteral}</strong> is
                this account's balance in {{ currency }}, as your bank shows it.
              </Trans>
            </Text>
            {worth !== null && rateText !== null && (
              <Text>
                <Trans>
                  <strong>Worth today</strong> is that balance at today's rate (
                  {{ rateText }}): {{ worth }}.
                </Trans>
              </Text>
            )}
            <Text>
              <Trans>
                <strong>In budget</strong> is what this account counts for in{' '}
                {{ budgetCurrency }}, the default currency: every transaction
                converted at its month's average rate, then added up. That makes{' '}
                {{ inBudget }}.
              </Trans>
            </Text>
            {difference !== 0 && (
              <Text style={{ color: theme.pageTextSubdued }}>
                <Trans>
                  They differ by {{ gap }} because the rate has moved since the
                  money came in. "Adjust to today's value" records that gap as a
                  transaction so the two match.
                </Trans>
              </Text>
            )}
          </View>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
