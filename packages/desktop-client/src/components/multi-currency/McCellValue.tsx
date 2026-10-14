// [fork:mc D-012] Drop-in replacement for upstream's `CellValue` on account
// balances. Foreign-currency accounts show their balance in their own
// currency; every other account renders upstream's `CellValue` unchanged.
import type { ReactNode } from 'react';

import type { AccountEntity } from '@actual-app/core/types/models';

import { CellValue } from '#components/spreadsheet/CellValue';
import type { FormatType } from '#hooks/useFormat';
import { useAccountCurrency } from '#hooks/useMultiCurrency';
import type { Binding, SheetFields, Spreadsheets } from '#spreadsheet';

import { McForeignCellValue } from './McForeignCellValue';
import type { McBalancePart } from './McForeignCellValue';

type McCellValueProps<FieldName extends SheetFields<'account'>> = {
  account: Pick<AccountEntity, 'id' | 'mc_currency'> | null | undefined;
  binding: Binding<'account', FieldName>;
  type?: FormatType;
  /** Which account-currency figure stands in for the binding */
  part?: McBalancePart;
  children?: (props: {
    type?: FormatType;
    name: string;
    value: Spreadsheets['account'][FieldName];
    formatter?: (value: Spreadsheets['account'][FieldName]) => string;
  }) => ReactNode;
};

export function McCellValue<FieldName extends SheetFields<'account'>>({
  account,
  binding,
  type,
  part = 'balance',
  children,
}: McCellValueProps<FieldName>) {
  const { isForeign, currency } = useAccountCurrency(account);

  if (!isForeign || !account) {
    return (
      <CellValue binding={binding} type={type}>
        {children}
      </CellValue>
    );
  }

  return (
    <McForeignCellValue
      accountId={account.id}
      currency={currency}
      part={part}
      type={type}
    >
      {children &&
        (props =>
          // Account balance fields hold numbers, which is what the
          // account-currency figure is
          children({
            ...props,
            value: props.value as Spreadsheets['account'][FieldName],
            formatter: value => props.formatter(Number(value)),
          }))}
    </McForeignCellValue>
  );
}
