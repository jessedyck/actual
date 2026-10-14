// [fork:mc D-007] Formats and parses integer amounts in any currency.
// Upstream's `useFormat` only knows the budget currency. This uses the same
// user preferences (number format, hidden decimals, symbol position and
// spacing) with the given currency's symbol and decimal places, so an
// account-currency amount looks like every other amount in the app.
import { evalArithmetic } from '@actual-app/core/shared/arithmetic';
import { getCurrency } from '@actual-app/core/shared/currencies';
import {
  amountToInteger,
  currencyToAmount,
  getNumberFormat,
  integerToAmount,
  integerToCurrency,
  parseNumberFormat,
} from '@actual-app/core/shared/util';
import type { IntegerAmount } from '@actual-app/core/shared/util';

import { useSyncedPref } from '#hooks/useSyncedPref';

export type MultiCurrencyFormatter = {
  /** e.g. `CA$1,234.56`; `withSign` adds `+` to positive values */
  format: (
    value: IntegerAmount,
    code: string,
    options?: { withSign?: boolean },
  ) => string;
  /** Number for an input field, without symbol, e.g. `1,234.56` */
  forEdit: (value: IntegerAmount, code: string) => string;
  /** Parses typed text (arithmetic allowed) into minor units of `code` */
  fromEdit: (text: string, code: string) => IntegerAmount | null;
  /** The symbol shown for `code`, falling back to the code itself */
  symbol: (code: string) => string;
  decimalPlaces: (code: string) => number;
};

export function useMultiCurrencyFormat(): MultiCurrencyFormatter {
  const [numberFormatPref] = useSyncedPref('numberFormat');
  const [hideFractionPref] = useSyncedPref('hideFraction');
  const [symbolPositionPref] = useSyncedPref('currencySymbolPosition');
  const [spaceEnabledPref] = useSyncedPref(
    'currencySpaceBetweenAmountAndSymbol',
  );
  const hideFraction = hideFractionPref === 'true';
  const { format: numberFormat } = parseNumberFormat({
    format: numberFormatPref,
    hideFraction,
  });

  function symbol(code: string): string {
    const currency = getCurrency(code);
    return currency.code === code && currency.symbol ? currency.symbol : code;
  }

  function decimalPlaces(code: string): number {
    return getCurrency(code).decimalPlaces;
  }

  function withSymbol(text: string, code: string): string {
    const currencySymbol = symbol(code);
    if (!currencySymbol) {
      return text;
    }
    const isNegative = text.startsWith('-');
    const unsigned = isNegative ? text.slice(1) : text;
    const space = spaceEnabledPref === 'true' ? ' ' : '';
    const styled =
      (symbolPositionPref || 'before') === 'after'
        ? `${unsigned}${space}${currencySymbol}`
        : `‪${currencySymbol}‬${space}${unsigned}`;
    return (isNegative ? '-' : '') + styled;
  }

  function format(
    value: IntegerAmount,
    code: string,
    { withSign = false }: { withSign?: boolean } = {},
  ): string {
    const places = decimalPlaces(code);
    const { formatter } = getNumberFormat({
      format: numberFormat,
      decimalPlaces: hideFraction ? 0 : places,
    });
    const text = withSymbol(integerToCurrency(value, formatter, places), code);
    return withSign && value >= 0 ? `+${text}` : text;
  }

  function forEdit(value: IntegerAmount, code: string): string {
    const places = decimalPlaces(code);
    const { formatter } = getNumberFormat({
      format: numberFormat,
      decimalPlaces: hideFraction ? 0 : places,
    });
    return formatter.format(integerToAmount(value, places));
  }

  function fromEdit(text: string, code: string): IntegerAmount | null {
    const trimmed = text?.trim() ?? '';
    if (trimmed === '') {
      return null;
    }
    // Same clean-up as upstream's `useFormat().fromEdit`: drop directional
    // marks and letters (currency codes), then allow arithmetic
    const normalized = trimmed.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\p{L}+/gu, '');
    let value: number | null = evalArithmetic(normalized, null);
    if (value === null || Number.isNaN(value)) {
      value = currencyToAmount(normalized);
    }
    if (value === null || Number.isNaN(value)) {
      return null;
    }
    return amountToInteger(value, decimalPlaces(code));
  }

  return { format, forEdit, fromEdit, symbol, decimalPlaces };
}
