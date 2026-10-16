// [fork:mc D-012] Currency picker for a new account. Renders nothing unless
// multi-currency accounts are on.
import { useTranslation } from 'react-i18next';

import { InlineField } from '@actual-app/components/inline-field';
import { Select } from '@actual-app/components/select';
import { currencies } from '@actual-app/core/shared/currencies';

import { useMultiCurrency } from '#hooks/useMultiCurrency';

type AccountCurrencyFieldProps = {
  /** Selected code; empty means the budget currency */
  value: string;
  onChange: (code: string) => void;
};

export function AccountCurrencyField({
  value,
  onChange,
}: AccountCurrencyFieldProps) {
  const { t } = useTranslation();
  const { isEnabled, budgetCurrency } = useMultiCurrency();

  if (!isEnabled) {
    return null;
  }

  const options: Array<[string, string]> = currencies
    .filter(item => item.code !== '')
    .map(item => [
      item.code,
      item.code === budgetCurrency
        ? t('{{code}} - {{name}} (default currency)', {
            code: item.code,
            name: item.name,
          })
        : `${item.code} - ${item.name}`,
    ]);

  return (
    <InlineField label={t('Currency')} width="100%">
      <Select
        value={value || budgetCurrency}
        options={options}
        onChange={onChange}
        style={{ flex: 1 }}
      />
    </InlineField>
  );
}
