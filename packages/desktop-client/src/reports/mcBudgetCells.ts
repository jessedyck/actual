// [fork:mc D-017] Reports add up categories' budget figures, which are each
// in their budget's own currency. The budget month handlers also return
// each figure in the default currency (`mc-d-budget-<id>` and so on, at the
// month's rate); reports read those, so every report adds up one currency.
import { send } from '@actual-app/core/platform/client/connection';

type MonthCell = { name: string; value: unknown };

export type McBudgetFigure = 'budget' | 'sum-amount' | 'leftover';

/**
 * A category's figure among a month's cells: in the default currency when
 * the month has it, otherwise the budget's own (multi-currency off).
 */
export function findBudgetFigureCell<T extends MonthCell>(
  cells: readonly T[],
  figure: McBudgetFigure,
  categoryId: string,
): T | undefined {
  const converted = `mc-d-${figure}-${categoryId}`;
  return (
    cells.find(cell => cell.name.endsWith(converted)) ??
    cells.find(
      cell =>
        cell.name.endsWith(`${figure}-${categoryId}`) &&
        !cell.name.includes('mc-d-'),
    )
  );
}

/**
 * Each category's budget for a month in the default currency, by category
 * id. Empty while budgets can't have a currency of their own.
 */
export async function getDefaultCurrencyBudgets(
  budgetType: 'envelope' | 'tracking' | undefined,
  month: string,
): Promise<Map<string, number>> {
  const cells: readonly MonthCell[] = await send(
    budgetType === 'tracking'
      ? 'tracking-budget-month'
      : 'envelope-budget-month',
    { month },
  );
  const budgets = new Map<string, number>();
  for (const cell of cells) {
    const match = /!mc-d-budget-(.+)$/.exec(cell.name);
    if (match) {
      budgets.set(match[1], typeof cell.value === 'number' ? cell.value : 0);
    }
  }
  return budgets;
}
