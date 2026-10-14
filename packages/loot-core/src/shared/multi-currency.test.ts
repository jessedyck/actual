// [fork:mc D-003]
import {
  convertMinorUnits,
  diffFromAccountCurrencyView,
  fromAccountCurrencyView,
  getAccountCurrency,
  getImpliedRate,
  isCurrencyCode,
  isForeignCurrencyAccount,
  makeRateId,
  roundHalfAwayFromZero,
  toAccountCurrencyView,
  updatesToAccountCurrencyView,
} from './multi-currency';

describe('multi-currency helpers', () => {
  it('converts between currencies with different minor units', () => {
    // 10.50 CAD at 0.62 EUR per CAD = 6.51 EUR
    expect(convertMinorUnits(1050, 0.62, 'CAD', 'EUR')).toBe(651);
    // 1 000 JPY (no minor units) at 0.0057 EUR per JPY = 5.70 EUR
    expect(convertMinorUnits(1000, 0.0057, 'JPY', 'EUR')).toBe(570);
    // 5.70 EUR back to JPY at 175.4386 JPY per EUR = 1 000 JPY
    expect(convertMinorUnits(570, 175.4386, 'EUR', 'JPY')).toBe(1000);
  });

  it('rounds symmetrically so transfers mirror exactly', () => {
    expect(convertMinorUnits(125, 0.5, 'EUR', 'EUR')).toBe(63);
    expect(convertMinorUnits(-125, 0.5, 'EUR', 'EUR')).toBe(-63);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Object.is(roundHalfAwayFromZero(-0.2), 0)).toBe(true);
  });

  it('trims floating point noise before rounding', () => {
    // 0.625 * 100 is 62.49999999999999 in floating point
    expect(roundHalfAwayFromZero(0.625 * 100)).toBe(63);
  });

  it('computes the rate a transaction was recorded at', () => {
    expect(getImpliedRate(651, 1050, 'CAD', 'EUR')).toBeCloseTo(0.62, 5);
    expect(getImpliedRate(570, 1000, 'JPY', 'EUR')).toBeCloseTo(0.0057, 7);
    expect(getImpliedRate(570, null, 'JPY', 'EUR')).toBeNull();
    expect(getImpliedRate(570, 0, 'JPY', 'EUR')).toBeNull();
  });

  it('knows which accounts use a foreign currency', () => {
    expect(isForeignCurrencyAccount({ mc_currency: 'CAD' }, 'EUR')).toBe(true);
    expect(isForeignCurrencyAccount({ mc_currency: 'EUR' }, 'EUR')).toBe(false);
    expect(isForeignCurrencyAccount({ mc_currency: null }, 'EUR')).toBe(false);
    expect(isForeignCurrencyAccount({ mc_currency: 'CAD' }, '')).toBe(false);
    expect(getAccountCurrency({ mc_currency: null }, 'EUR')).toBe('EUR');
    expect(getAccountCurrency({ mc_currency: 'CAD' }, 'EUR')).toBe('CAD');
  });

  it('builds deterministic rate ids and validates codes', () => {
    expect(makeRateId('2026-10-13', 'CAD', 'EUR')).toBe('20261013:CAD:EUR');
    expect(isCurrencyCode('CAD')).toBe(true);
    expect(isCurrencyCode('cad')).toBe(false);
    expect(isCurrencyCode('CA')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });
});

// [fork:mc D-013]
describe('account-currency register view', () => {
  const stored = { id: 'a', amount: -651, mc_amount: -1050 };

  it('shows the account amount and keeps the budget amount aside', () => {
    const view = toAccountCurrencyView(stored);
    expect(view.amount).toBe(-1050);
    expect(view._mcBudgetAmount).toBe(-651);
    expect(toAccountCurrencyView(view)).toBe(view);
    expect(fromAccountCurrencyView(view)).toEqual(stored);
  });

  it('keeps an edited account amount when leaving the view', () => {
    const view = { ...toAccountCurrencyView(stored), amount: -2000 };
    expect(fromAccountCurrencyView(view)).toEqual({
      id: 'a',
      amount: -651,
      mc_amount: -2000,
    });
  });

  it('estimates missing account amounts without storing the estimate', () => {
    const missing = { id: 'b', amount: -620, mc_amount: null };
    const view = toAccountCurrencyView(missing, amount => amount * 2);
    expect(view.amount).toBe(-1240);
    expect(fromAccountCurrencyView(view)).toEqual(missing);
    expect(fromAccountCurrencyView({ ...view, amount: -1000 }).mc_amount).toBe(
      -1000,
    );
  });

  it('turns register diffs into account amounts for the server', () => {
    const diff = diffFromAccountCurrencyView({
      added: [{ id: 'new', amount: -1500 }],
      updated: [
        { id: 'a', amount: -2000 },
        { id: 'c', category: 'food' },
      ],
    });
    // New: the budget amount is left at 0 for the server to derive
    expect(diff.added).toEqual([{ id: 'new', mc_amount: -1500, amount: 0 }]);
    // Edited: only the account amount changes; the server re-derives
    expect(diff.updated).toEqual([
      { id: 'a', mc_amount: -2000 },
      { id: 'c', category: 'food' },
    ]);
  });

  it('does not store an untouched estimate for added rows', () => {
    const view = toAccountCurrencyView(
      { id: 'p', amount: -620, mc_amount: null },
      amount => amount * 2,
    );
    const diff = diffFromAccountCurrencyView({ added: [view] });
    expect(diff.added?.[0]).toEqual({ id: 'p', amount: -620, mc_amount: null });
  });

  it('maps server updates onto the view', () => {
    expect(
      updatesToAccountCurrencyView([
        { id: 'a', amount: -700, mc_amount: -1100 },
        { id: 'b', category: null },
      ]),
    ).toEqual([
      { id: 'a', amount: -1100, mc_amount: -1100, _mcBudgetAmount: -700 },
      { id: 'b', category: null },
    ]);
  });
});
