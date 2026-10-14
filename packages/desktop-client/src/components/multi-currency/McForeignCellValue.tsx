// [fork:mc D-012] An account-currency balance styled like upstream's
// `CellValueText` (privacy filter, tabular numbers).
import type { ReactNode } from 'react';

import { CellValueText } from '#components/spreadsheet/CellValue';
import type { FormatType } from '#hooks/useFormat';
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

export type McBalancePart = 'balance' | 'cleared' | 'uncleared';

type McForeignCellValueProps = {
  accountId: string;
  currency: string;
  part: McBalancePart;
  type?: FormatType;
  children?: (props: {
    type?: FormatType;
    name: string;
    value: number;
    formatter: (value: number) => string;
  }) => ReactNode;
};

export function McForeignCellValue({
  accountId,
  currency,
  part,
  type = 'financial',
  children,
}: McForeignCellValueProps) {
  const balances = useMcAccountBalance(accountId);
  const { format } = useMultiCurrencyFormat();
  const value = balances?.[part] ?? 0;
  const name = `mc-${part}-${accountId}`;
  const formatter = (amount: number) =>
    format(amount, currency, { withSign: type === 'financial-with-sign' });

  if (children) {
    return <>{children({ type, name, value, formatter })}</>;
  }
  return (
    <CellValueText<'account', 'balance'>
      type={type}
      name={name}
      value={value}
      formatter={formatter}
    />
  );
}
