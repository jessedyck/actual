import React from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Menu } from '@actual-app/components/menu';
import type { MenuItem } from '@actual-app/components/menu';

import { useFeatureFlag } from '#hooks/useFeatureFlag';

type BudgetMenuProps = Omit<
  ComponentPropsWithoutRef<typeof Menu>,
  'onMenuSelect' | 'items'
> & {
  onCopyLastMonthAverage: () => void;
  onSetMonthsAverage: (numberOfMonths: number) => void;
  onApplyBudgetTemplate: () => void;
  onCopyUntilYearEnd: () => void;
  // [fork:mc D-017] The budget's currency, when multi-currency is on
  onSetCurrency?: () => void;
  currencyLabel?: string;
};
export function BudgetMenu({
  onCopyLastMonthAverage,
  onSetMonthsAverage,
  onApplyBudgetTemplate,
  onCopyUntilYearEnd,
  onSetCurrency,
  currencyLabel,
  ...props
}: BudgetMenuProps) {
  const { t } = useTranslation();
  const isGoalTemplatesEnabled = useFeatureFlag('goalTemplatesEnabled');
  const onMenuSelect = (name: string) => {
    switch (name) {
      case 'copy-single-last':
        onCopyLastMonthAverage?.();
        break;
      case 'set-single-3-avg':
        onSetMonthsAverage?.(3);
        break;
      case 'set-single-6-avg':
        onSetMonthsAverage?.(6);
        break;
      case 'set-single-12-avg':
        onSetMonthsAverage?.(12);
        break;
      case 'apply-single-category-template':
        onApplyBudgetTemplate?.();
        break;
      case 'copy-until-year-end':
        onCopyUntilYearEnd?.();
        break;
      // [fork:mc D-017]
      case 'mc-set-currency':
        onSetCurrency?.();
        break;
      default:
        throw new Error(`Unrecognized menu item: ${name}`);
    }
  };

  return (
    <Menu
      {...props}
      onMenuSelect={onMenuSelect}
      items={[
        {
          name: 'copy-single-last',
          text: t("Copy last month's budget"),
        },
        {
          name: 'set-single-3-avg',
          text: t('Set to 3 month average'),
        },
        {
          name: 'set-single-6-avg',
          text: t('Set to 6 month average'),
        },
        {
          name: 'set-single-12-avg',
          text: t('Set to yearly average'),
        },
        {
          name: 'copy-until-year-end',
          text: t('Copy until year end'),
        },
        ...(isGoalTemplatesEnabled
          ? [
              {
                name: 'apply-single-category-template',
                text: t('Overwrite with template'),
              },
            ]
          : []),
        // [fork:mc D-017]
        ...(onSetCurrency
          ? ([
              Menu.line,
              {
                name: 'mc-set-currency',
                text: t('Currency: {{currency}}…', {
                  currency: currencyLabel,
                }),
              },
            ] satisfies Array<MenuItem>)
          : []),
      ]}
    />
  );
}
