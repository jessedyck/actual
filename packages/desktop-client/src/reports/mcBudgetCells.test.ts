// [fork:mc D-017]
import { findBudgetFigureCell } from './mcBudgetCells';

describe('findBudgetFigureCell', () => {
  const cells = [
    { name: 'budget202610!budget-food', value: 40000 },
    { name: 'budget202610!group-budget-group', value: 65000 },
    { name: 'budget202610!mc-d-budget-food', value: 25000 },
  ];

  it('prefers the figure in the default currency', () => {
    expect(findBudgetFigureCell(cells, 'budget', 'food')?.value).toBe(25000);
  });

  it("falls back to the budget's own figure", () => {
    expect(
      findBudgetFigureCell(cells.slice(0, 2), 'budget', 'food')?.value,
    ).toBe(40000);
    expect(findBudgetFigureCell(cells, 'leftover', 'food')).toBeUndefined();
  });
});
