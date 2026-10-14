import React, { useState } from 'react';
import type { ComponentProps } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { SvgFilter } from '@actual-app/components/icons/v1';
import { Label } from '@actual-app/components/label';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { Search } from '#components/common/Search';
import { PullToRefresh } from '#components/mobile/PullToRefresh';
// [fork:mc D-012]
import { McCellValue } from '#components/multi-currency/McCellValue';
import type { McBalancePart } from '#components/multi-currency/McForeignCellValue';
import { CellValue, CellValueText } from '#components/spreadsheet/CellValue';
import { DisplayPayeeProvider } from '#hooks/useDisplayPayee';
import { SelectedProvider, useSelected } from '#hooks/useSelected';
import { useSheetValue } from '#hooks/useSheetValue';
import type { Binding, SheetFields, SheetNames } from '#spreadsheet';

import { TransactionList } from './TransactionList';

type TransactionSearchInputProps = {
  placeholder: string;
  onSearch: TransactionListWithBalancesProps['onSearch'];
};

function TransactionSearchInput({
  placeholder,
  onSearch,
}: TransactionSearchInputProps) {
  const [text, setText] = useState('');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.mobilePageBackground,
        padding: 10,
        width: '100%',
      }}
    >
      <Search
        value={text}
        onChange={text => {
          setText(text);
          onSearch(text);
        }}
        placeholder={placeholder}
        width="100%"
        height={styles.mobileMinHeight}
        style={{
          backgroundColor: theme.tableBackground,
          borderColor: theme.formInputBorder,
        }}
      />
    </View>
  );
}

type TransactionListWithBalancesProps = {
  isLoading: boolean;
  transactions: readonly TransactionEntity[];
  balance:
    | Binding<'account', 'onbudget-accounts-balance'>
    | Binding<'account', 'offbudget-accounts-balance'>
    | Binding<'account', 'closed-accounts-balance'>
    | Binding<SheetNames, 'uncategorized-balance'>
    | Binding<'category', 'balance'>
    | Binding<'account', 'balance'>
    | Binding<'account', 'accounts-balance'>;
  balanceCleared?:
    | Binding<'category', 'balanceCleared'>
    | Binding<'account', 'balanceCleared'>;
  balanceUncleared?:
    | Binding<'category', 'balanceUncleared'>
    | Binding<'account', 'balanceUncleared'>;
  showRunningBalances?: boolean;
  runningBalances?: Map<TransactionEntity['id'], IntegerAmount>;
  searchPlaceholder: string;
  onSearch: (searchText: string) => void;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onOpenTransaction: (transaction: TransactionEntity) => void;
  onRefresh?: () => void;
  showMakeTransfer?: boolean;
  isReconciling?: boolean;
  onToggleTransactionCleared?: (transaction: TransactionEntity) => void;
  filtered?: boolean;
  /**
   * [fork:mc D-012] The account whose page this is: a foreign-currency
   * account shows its balances in its own currency.
   */
  mcAccount?: AccountEntity;
};

export function TransactionListWithBalances({
  isLoading,
  transactions,
  balance,
  balanceCleared,
  balanceUncleared,
  showRunningBalances,
  runningBalances,
  searchPlaceholder = 'Search...',
  onSearch,
  isLoadingMore,
  onLoadMore,
  onOpenTransaction,
  onRefresh,
  showMakeTransfer = false,
  isReconciling = false,
  onToggleTransactionCleared,
  filtered = false,
  mcAccount,
}: TransactionListWithBalancesProps) {
  const selectedInst = useSelected('transactions', [...transactions], []);

  return (
    <DisplayPayeeProvider transactions={transactions}>
      <SelectedProvider instance={selectedInst}>
        <View
          style={{
            flexShrink: 0,
            marginTop: 10,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-evenly',
            }}
          >
            {balanceCleared && balanceUncleared ? (
              <BalanceWithCleared
                balance={balance}
                balanceCleared={balanceCleared}
                balanceUncleared={balanceUncleared}
                alwaysShowCleared={isReconciling}
                mcAccount={mcAccount}
              />
            ) : (
              <>
                <View style={{ flexBasis: '33%' }} />
                <Balance balance={balance} mcAccount={mcAccount} />
                <View
                  style={{
                    flexBasis: '33%',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {filtered && <AppliedFiltersChip />}
                </View>
              </>
            )}
          </View>
          <TransactionSearchInput
            placeholder={searchPlaceholder}
            onSearch={onSearch}
          />
        </View>
        <PullToRefresh
          isPullable={!isLoading && !!onRefresh}
          onRefresh={async () => onRefresh?.()}
          style={{
            '& .ptr__children': {
              display: 'flex',
            },
          }}
        >
          <TransactionList
            isLoading={isLoading}
            transactions={transactions}
            showRunningBalances={showRunningBalances}
            runningBalances={runningBalances}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            onOpenTransaction={onOpenTransaction}
            showMakeTransfer={showMakeTransfer}
            isReconciling={isReconciling}
            onToggleTransactionCleared={onToggleTransactionCleared}
          />
        </PullToRefresh>
      </SelectedProvider>
    </DisplayPayeeProvider>
  );
}

function AppliedFiltersChip() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: theme.pillBackgroundSelected,
        color: theme.pillTextSelected,
        borderRadius: 15,
        padding: '4px 10px',
      }}
    >
      <SvgFilter width={12} height={12} style={{ flexShrink: 0 }} />
      <Text size="small" style={{ fontWeight: 500 }}>
        <Trans>Filters applied</Trans>
      </Text>
    </View>
  );
}

const TransactionListBalanceCellValue = <
  FieldName extends SheetFields<'account'> | SheetFields<'category'>,
>({
  mcAccount,
  mcPart = 'balance',
  ...props
}: ComponentProps<
  typeof CellValue<
    FieldName extends SheetFields<'account'> ? 'account' : 'category',
    FieldName
  >
> & {
  // [fork:mc D-012] Account-currency figure for a foreign-currency account
  mcAccount?: AccountEntity;
  mcPart?: McBalancePart;
}) => {
  if (mcAccount) {
    const { children } = props;
    type ChildProps = Parameters<NonNullable<typeof children>>[0];
    // Only an account page passes `mcAccount`, so these are its bindings
    return (
      <McCellValue<SheetFields<'account'>>
        account={mcAccount}
        binding={props.binding as Binding<'account', SheetFields<'account'>>}
        part={mcPart}
        type={props.type}
      >
        {children &&
          (childProps => children(childProps as unknown as ChildProps))}
      </McCellValue>
    );
  }
  return <CellValue {...props} />;
};

type BalanceWithClearedProps = {
  balanceUncleared: NonNullable<
    TransactionListWithBalancesProps['balanceUncleared']
  >;
  balanceCleared: NonNullable<
    TransactionListWithBalancesProps['balanceCleared']
  >;
  balance: TransactionListWithBalancesProps['balance'];
  alwaysShowCleared?: boolean;
  mcAccount?: AccountEntity;
};

function BalanceWithCleared({
  balanceUncleared,
  balanceCleared,
  balance,
  alwaysShowCleared = false,
  mcAccount,
}: BalanceWithClearedProps) {
  const { t } = useTranslation();
  const unclearedAmount = useSheetValue<
    'account' | 'category',
    'balanceUncleared'
  >(balanceUncleared);
  const showCleared = !!unclearedAmount || alwaysShowCleared;

  return (
    <>
      <View
        style={{
          display: !showCleared ? 'none' : undefined,
          flexBasis: '33%',
        }}
      >
        <Label
          title={t('Cleared')}
          style={{ textAlign: 'center', fontSize: 12 }}
        />
        <TransactionListBalanceCellValue
          binding={balanceCleared}
          type="financial"
          mcAccount={mcAccount}
          mcPart="cleared"
        >
          {props => (
            <CellValueText
              {...props}
              style={{
                fontSize: 12,
                textAlign: 'center',
                fontWeight: '500',
              }}
              data-testid="transactions-balance-cleared"
            />
          )}
        </TransactionListBalanceCellValue>
      </View>
      <Balance balance={balance} mcAccount={mcAccount} />
      <View
        style={{
          display: !showCleared ? 'none' : undefined,
          flexBasis: '33%',
        }}
      >
        <Label
          title={t('Uncleared')}
          style={{ textAlign: 'center', fontSize: 12 }}
        />
        <TransactionListBalanceCellValue
          binding={balanceUncleared}
          type="financial"
          mcAccount={mcAccount}
          mcPart="uncleared"
        >
          {props => (
            <CellValueText
              {...props}
              style={{
                fontSize: 12,
                textAlign: 'center',
                fontWeight: '500',
              }}
              data-testid="transactions-balance-uncleared"
            />
          )}
        </TransactionListBalanceCellValue>
      </View>
    </>
  );
}

type BalanceProps = {
  balance: TransactionListWithBalancesProps['balance'];
  mcAccount?: AccountEntity;
};

function Balance({ balance, mcAccount }: BalanceProps) {
  const { t } = useTranslation();
  return (
    <View style={{ flexBasis: '33%' }}>
      <Label title={t('Balance')} style={{ textAlign: 'center' }} />
      <TransactionListBalanceCellValue
        binding={balance}
        type="financial"
        mcAccount={mcAccount}
      >
        {props => (
          <CellValueText
            {...props}
            style={{
              fontSize: 18,
              textAlign: 'center',
              fontWeight: '500',
              color:
                props.value < 0
                  ? theme.numberNegative
                  : props.value > 0
                    ? theme.numberPositive
                    : theme.numberNeutral,
            }}
            data-testid="transactions-balance"
          />
        )}
      </TransactionListBalanceCellValue>
    </View>
  );
}
