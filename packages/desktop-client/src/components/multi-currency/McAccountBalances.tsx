// [fork:mc D-012] Account header balances for a foreign-currency account:
// the balance in the account's currency, what it is worth today in the
// budget currency, and the budget-currency total of its transactions.
import { useRef } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgArrowButtonRight1 } from '@actual-app/components/icons/v2';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { convertMinorUnits } from '@actual-app/core/shared/multi-currency';
import type { Query } from '@actual-app/core/shared/query';
import type { AccountEntity } from '@actual-app/core/types/models';
import { useHover } from 'usehooks-ts';

import { SelectedBalance } from '#components/accounts/Balance';
import { CellValueText } from '#components/spreadsheet/CellValue';
import { useFormat } from '#hooks/useFormat';
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useMcRate } from '#hooks/useMcRate';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';
import { useSelectedItems } from '#hooks/useSelected';
import { useSheetValue } from '#hooks/useSheetValue';

import { McBalancePill } from './McBalancePill';
import { McBalancesHelp } from './McBalancesHelp';
import { McRevaluationButton } from './McRevaluationButton';

type McAccountBalancesProps = {
  account: AccountEntity;
  currency: string;
  budgetCurrency: string;
  balanceQuery: { name: `balance-query-${string}`; query: Query };
  showExtraBalances: boolean;
  onToggleExtraBalances: () => void;
  isFiltered: boolean;
  filteredAmount?: number | null;
};

export function McAccountBalances({
  account,
  currency,
  budgetCurrency,
  balanceQuery,
  showExtraBalances,
  onToggleExtraBalances,
  isFiltered,
  filteredAmount,
}: McAccountBalancesProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const mcFormat = useMultiCurrencyFormat();
  const selectedItems = useSelectedItems();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isButtonHovered = useHover(buttonRef as RefObject<HTMLButtonElement>);
  const balances = useMcAccountBalance(account.id);
  const rate = useMcRate(currency, budgetCurrency);
  const budgetValue = useSheetValue<'balance', `balance-query-${string}`>({
    ...balanceQuery,
    value: 0,
  });

  const balance = balances?.balance ?? 0;
  const worthToday =
    rate.status === 'found'
      ? convertMinorUnits(balance, rate.rate, currency, budgetCurrency)
      : null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: -5,
        marginLeft: -5,
        gap: 10,
      }}
    >
      <Button
        ref={buttonRef}
        data-testid="account-balance"
        variant="bare"
        onPress={onToggleExtraBalances}
        style={{ paddingTop: 1, paddingBottom: 1 }}
      >
        <CellValueText<'account', 'balance'>
          type="financial"
          name={`mc-balance-${account.id}`}
          value={balance}
          formatter={value => mcFormat.format(value, currency)}
          style={{
            fontSize: 22,
            fontWeight: 400,
            color:
              balance < 0
                ? theme.numberNegative
                : balance > 0
                  ? theme.numberPositive
                  : theme.pageTextSubdued,
          }}
        />
        <SvgArrowButtonRight1
          style={{
            width: 10,
            height: 10,
            marginLeft: 10,
            color: theme.pillText,
            transform: showExtraBalances ? 'rotateZ(180deg)' : 'rotateZ(0)',
            opacity:
              isButtonHovered || selectedItems.size > 0 || showExtraBalances
                ? 1
                : 0,
          }}
        />
      </Button>

      <McBalancePill
        name={t('Worth today:')}
        value={
          worthToday === null
            ? rate.status === 'loading'
              ? '…'
              : t('no rate')
            : format(worthToday, 'financial')
        }
        title={
          rate.status === 'found'
            ? t('1 {{base}} = {{rate}} {{quote}} on {{date}}', {
                base: currency,
                quote: budgetCurrency,
                rate: Number(rate.rate.toPrecision(6)),
                date: rate.date,
              })
            : t('No exchange rate available for today')
        }
      />
      <McBalancePill
        name={t('In budget:')}
        value={format(budgetValue ?? 0, 'financial')}
        title={t(
          "The default-currency total of this account's transactions, each at its month's average rate",
        )}
      />
      <McBalancesHelp
        currency={currency}
        budgetCurrency={budgetCurrency}
        balance={balance}
        worthToday={worthToday}
        budgetValue={budgetValue ?? 0}
        rate={rate}
      />
      {/* [fork:mc D-014] */}
      <McRevaluationButton
        account={account}
        currency={currency}
        worthToday={worthToday}
        budgetValue={budgetValue ?? 0}
      />

      {showExtraBalances && (
        <>
          <McBalancePill
            name={t('Cleared total:')}
            value={mcFormat.format(balances?.cleared ?? 0, currency)}
          />
          <McBalancePill
            name={t('Uncleared total:')}
            value={mcFormat.format(balances?.uncleared ?? 0, currency)}
          />
        </>
      )}

      {selectedItems.size > 0 && (
        <SelectedBalance selectedItems={selectedItems} account={account} />
      )}
      {isFiltered && (
        <McBalancePill
          name={t('Filtered balance:')}
          // Summed in the account currency by the account page (D-013)
          value={mcFormat.format(filteredAmount ?? 0, currency)}
        />
      )}
    </View>
  );
}
