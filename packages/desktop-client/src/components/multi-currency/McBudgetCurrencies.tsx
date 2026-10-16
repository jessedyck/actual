// [fork:mc D-017] The currency of each category's budget in each month.
//
// A budget page reads it once (`McBudgetCurrenciesProvider`); each category
// cell then formats its amounts in its budget's currency
// (`McBudgetCurrency`). Group rows, To Budget and the other totals stay in
// the default currency.
import { createContext, Fragment, useContext } from 'react';
import type { ReactNode } from 'react';

import {
  getBudgetCurrencyAt,
  parseCurrencyPeriods,
} from '@actual-app/core/shared/multi-currency';
import { q } from '@actual-app/core/shared/query';

import { McDisplayCurrencyContext } from '#hooks/useMcDisplayCurrency';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { useQuery } from '#hooks/useQuery';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

/** A category's budget currency in a month (`YYYY-MM`). */
export type BudgetCurrencyLookup = (
  categoryId: string,
  month: string,
) => string;

const BudgetCurrenciesContext = createContext<BudgetCurrencyLookup | null>(
  null,
);

type BudgetCurrencyRow = {
  month: number;
  category: string;
  mc_currency: string;
};

function monthOfRow(month: number): string {
  const text = String(month);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

/** Reads the budgets' currencies; null while the feature is off. */
export function useBudgetCurrencyLookup(): BudgetCurrencyLookup | null {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const [budgetType] = useSyncedPref('budgetType');
  const [periodsPref] = useSyncedPref('mcCurrencyPeriods');
  const table = budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets';
  const { data } = useQuery<BudgetCurrencyRow>(
    () =>
      isEnabled
        ? q(table)
            .filter({ mc_currency: { $ne: null } })
            .select(['month', 'category', 'mc_currency'])
        : null,
    [isEnabled, table],
  );
  if (!isEnabled) {
    return null;
  }
  const periods = parseCurrencyPeriods(periodsPref);
  const explicit = new Map(
    (data ?? []).map(row => [
      `${monthOfRow(row.month)}:${row.category}`,
      row.mc_currency,
    ]),
  );
  return (categoryId, month) =>
    explicit.get(`${month}:${categoryId}`) ??
    getBudgetCurrencyAt(month, periods, budgetCurrency);
}

export function McBudgetCurrenciesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const lookup = useBudgetCurrencyLookup();
  return (
    <BudgetCurrenciesContext.Provider value={lookup}>
      {children}
    </BudgetCurrenciesContext.Provider>
  );
}

/** The surrounding page's budget currencies (null outside a budget page). */
export function usePageBudgetCurrencies(): BudgetCurrencyLookup | null {
  return useContext(BudgetCurrenciesContext);
}

/** A category's budget currency in a month, from the surrounding page. */
export function useBudgetCurrencyOf(
  categoryId: string,
  month: string,
): string | null {
  const lookup = useContext(BudgetCurrenciesContext);
  return lookup ? lookup(categoryId, month) : null;
}

/**
 * Formats the amounts inside it (budgeted, spent, balance) in the currency
 * of a category's budget for a month.
 */
export function McBudgetCurrency({
  categoryId,
  month,
  children,
}: {
  categoryId: string;
  month: string;
  children: ReactNode;
}) {
  const { budgetCurrency } = useMultiCurrency();
  const currency = useBudgetCurrencyOf(categoryId, month);
  const override = currency && currency !== budgetCurrency ? currency : null;
  return (
    <McDisplayCurrencyContext.Provider value={override}>
      {/* Remounted when the currency changes, so text that sized itself to
          its amount (mobile cells) measures again */}
      <Fragment key={override ?? ''}>{children}</Fragment>
    </McDisplayCurrencyContext.Provider>
  );
}

type BudgetCurrencyMenu = {
  currencyLabel: string;
  /** The budget's currency is not the default one */
  isOwnCurrency: boolean;
  onSetCurrency: () => void;
};

function useCurrencyMenu(
  currency: string | null,
  categoryId: string,
  month: string,
): BudgetCurrencyMenu | null {
  const { isEnabled, budgetCurrency } = useMultiCurrency();
  const dispatch = useDispatch();
  if (!isEnabled) {
    return null;
  }
  return {
    currencyLabel: currency ?? budgetCurrency,
    isOwnCurrency: currency !== null && currency !== budgetCurrency,
    onSetCurrency: () =>
      dispatch(
        pushModal({
          modal: {
            name: 'mc-budget-currency',
            options: { month, categoryId },
          },
        }),
      ),
  };
}

/**
 * The budget menu's currency item: the budget's currency and opening the
 * dialog that changes it. Null while multi-currency is off.
 */
export function useBudgetCurrencyMenu(
  categoryId: string,
  month: string,
): BudgetCurrencyMenu | null {
  const currency = useBudgetCurrencyOf(categoryId, month);
  return useCurrencyMenu(currency, categoryId, month);
}

/** The same, for a dialog outside the budget page (the mobile budget menu). */
export function useOwnBudgetCurrencyMenu(
  categoryId: string,
  month: string,
): BudgetCurrencyMenu | null {
  const lookup = useBudgetCurrencyLookup();
  return useCurrencyMenu(
    lookup ? lookup(categoryId, month) : null,
    categoryId,
    month,
  );
}

/**
 * True when a budget has a currency of its own, or budgets without one keep
 * an earlier default currency. Changing the default then needs the "Change
 * default currency" tool, which keeps them as they are.
 */
export function useHasBudgetCurrencies(): boolean {
  const [budgetType] = useSyncedPref('budgetType');
  const [periodsPref] = useSyncedPref('mcCurrencyPeriods');
  const table = budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets';
  const { data } = useQuery<{ id: string }>(
    () =>
      q(table)
        .filter({ mc_currency: { $ne: null } })
        .select(['id'])
        .limit(1),
    [table],
  );
  return (
    (data?.length ?? 0) > 0 || parseCurrencyPeriods(periodsPref).length > 0
  );
}
