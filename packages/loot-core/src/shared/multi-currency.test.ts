// [fork:mc D-003]
import {
  convertMinorUnits,
  getAccountCurrency,
  getImpliedRate,
  isCurrencyCode,
  isForeignCurrencyAccount,
  makeRateId,
  roundHalfAwayFromZero,
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
