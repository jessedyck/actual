// [fork:mc D-013] Tooltip for an amount in a foreign-currency register: the
// transaction's budget-currency amount, and whether the shown account amount
// is only an estimate (schedule previews, pending conversions).
import { useTranslation } from 'react-i18next';

import type { AccountCurrencyViewFields } from '@actual-app/core/shared/multi-currency';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { useFormat } from '#hooks/useFormat';

export function useMcBudgetAmountTitle(
  transaction: TransactionEntity,
): string | undefined {
  const { t } = useTranslation();
  const format = useFormat();
  const view: TransactionEntity & AccountCurrencyViewFields = transaction;

  if (!view._mcView) {
    return undefined;
  }
  // Unsigned, like the Payment and Deposit columns it explains
  const budgetAmount = format(Math.abs(view._mcBudgetAmount ?? 0), 'financial');
  return view._mcEstimate !== undefined
    ? t("Estimated at today's rate. In budget: {{amount}}", {
        amount: budgetAmount,
      })
    : t('In budget: {{amount}}', { amount: budgetAmount });
}
