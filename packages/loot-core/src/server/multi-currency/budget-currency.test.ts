// [fork:mc D-017]
import type { MockInstance } from 'vitest';

import { copyPreviousMonth } from '#server/budget/actions';
import { createAllBudgets } from '#server/budget/base';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import { batchUpdateTransactions } from '#server/transactions';
import * as monthUtils from '#shared/months';

import { recomputePending } from './accounts';
import { setBudgetCurrency } from './budget-currency';
import { getMonthRates, refreshMonthRates, setMonthRate } from './month-rates';
import { setManualRate } from './rates';

// Test dates are in 2016 because `currentDay()` is pinned to 2017-01-01
// under test; the network is never reached.
let mockedFetch: MockInstance<typeof globalThis.fetch>;

beforeEach(global.emptyDatabase());
beforeEach(() => {
  mockedFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));
});
afterEach(() => {
  mockedFetch.mockRestore();
});

async function setPref(id: string, value: string) {
  await db.update('preferences', { id, value });
}

const DECEMBER = monthUtils.sheetForMonth('2016-12');
const JANUARY = monthUtils.sheetForMonth('2017-01');

// A EUR budget file with a CAD account; 1 CAD = 0.6 EUR in December
async function setupBudget() {
  await setPref('flags.multiCurrency', 'true');
  await setPref('defaultCurrencyCode', 'EUR');
  await setPref('mcRatesOnline', 'false');
  await setManualRate({
    date: '2016-12-01',
    base: 'CAD',
    quote: 'EUR',
    rate: 0.6,
  });

  await db.insertCategoryGroup({ id: 'group', name: 'Expenses' });
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'group' });
  await db.insertCategory({ id: 'rent', name: 'Rent', cat_group: 'group' });
  await db.insertCategory({
    id: 'salary',
    name: 'Salary',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertAccount({ id: 'eur', name: 'Compte' });
  await db.insertAccount({ id: 'cad', name: 'Chequing', mc_currency: 'CAD' });

  await sheet.loadSpreadsheet(db);
  await createAllBudgets();
}

async function getTransaction(id: string) {
  return db.first<{
    amount: number;
    mc_amount: number | null;
    mc_budget_amount: number | null;
  }>(
    'SELECT amount, mc_amount, mc_budget_amount FROM v_transactions_internal_alive WHERE id = ?',
    [id],
  );
}

function cell(sheetName: string, name: string) {
  return sheet.getCellValue(sheetName, name);
}

describe('a currency on each budget', () => {
  it('counts a CAD budget in CAD and its group in EUR', async () => {
    await setupBudget();
    await db.insert('zero_budgets', {
      id: '201612-food',
      month: 201612,
      category: 'food',
      amount: 40000,
    });
    await setBudgetCurrency({
      month: '2016-12',
      category: 'rent',
      currency: 'CAD',
    });
    await db.update('zero_budgets', { id: '201612-rent', amount: 195000 });

    await batchUpdateTransactions({
      added: [
        {
          id: 'rent',
          account: 'cad',
          date: '2016-12-10',
          amount: 0,
          mc_amount: -190000,
          category: 'rent',
        },
        {
          id: 'food-cad',
          account: 'cad',
          date: '2016-12-11',
          amount: 0,
          mc_amount: -5000,
          category: 'food',
        },
        {
          id: 'food-eur',
          account: 'eur',
          date: '2016-12-12',
          amount: -2000,
          category: 'food',
        },
        {
          id: 'pay',
          account: 'eur',
          date: '2016-12-01',
          amount: 300000,
          category: 'salary',
        },
      ],
    });
    await sheet.waitOnSpreadsheet();

    // The CAD bill counts exactly in its CAD budget
    expect(await getTransaction('rent')).toEqual({
      amount: -114000,
      mc_amount: -190000,
      mc_budget_amount: -190000,
    });
    // A CAD purchase in a EUR budget counts at the month's rate
    expect(await getTransaction('food-cad')).toEqual({
      amount: -3000,
      mc_amount: -5000,
      mc_budget_amount: null,
    });
    expect(cell(DECEMBER, 'sum-amount-rent')).toBe(-190000);
    expect(cell(DECEMBER, 'leftover-rent')).toBe(5000);
    expect(cell(DECEMBER, 'sum-amount-food')).toBe(-5000);
    expect(cell(DECEMBER, 'leftover-food')).toBe(35000);

    // Totals are in EUR: the rent budget counts 1 950 CAD = 1 170 EUR
    expect(cell(DECEMBER, 'group-budget-group')).toBe(40000 + 117000);
    expect(cell(DECEMBER, 'group-sum-amount-group')).toBe(-5000 - 114000);
    expect(cell(DECEMBER, 'group-leftover-group')).toBe(35000 + 3000);
    expect(cell(DECEMBER, 'to-budget')).toBe(300000 - 157000);

    // January's rent budget has no currency of its own: the leftover
    // 50 CAD arrives as 30 EUR
    expect(cell(JANUARY, 'leftover-rent')).toBe(3000);
    expect(cell(JANUARY, 'from-last-month')).toBe(143000);
  });

  it('converts or keeps the amount when the currency changes', async () => {
    await setupBudget();
    await db.insert('zero_budgets', {
      id: '201612-food',
      month: 201612,
      category: 'food',
      amount: 60000,
    });
    await batchUpdateTransactions({
      added: [
        {
          id: 'food-eur',
          account: 'eur',
          date: '2016-12-12',
          amount: -3000,
          category: 'food',
        },
      ],
    });

    // Converting: 600 EUR is 1 000 CAD at 0.6
    const converted = await setBudgetCurrency({
      month: '2016-12',
      category: 'food',
      currency: 'CAD',
      convert: true,
    });
    expect(converted).toEqual({ amount: 100000, currency: 'CAD' });
    expect((await getTransaction('food-eur'))?.mc_budget_amount).toBe(-5000);
    await sheet.waitOnSpreadsheet();
    expect(cell(DECEMBER, 'budget-food')).toBe(100000);
    expect(cell(DECEMBER, 'sum-amount-food')).toBe(-5000);
    expect(cell(DECEMBER, 'group-budget-group')).toBe(60000);

    // Back to the default currency, keeping the number
    await setBudgetCurrency({
      month: '2016-12',
      category: 'food',
      currency: null,
    });
    expect((await getTransaction('food-eur'))?.mc_budget_amount).toBeNull();
    await sheet.waitOnSpreadsheet();
    expect(cell(DECEMBER, 'budget-food')).toBe(100000);
    expect(cell(DECEMBER, 'sum-amount-food')).toBe(-3000);
  });

  it("copies currencies with last month's budget", async () => {
    await setupBudget();
    await setBudgetCurrency({
      month: '2016-12',
      category: 'rent',
      currency: 'CAD',
    });
    await db.update('zero_budgets', { id: '201612-rent', amount: 190000 });
    await copyPreviousMonth({ month: '2017-01' });

    const january = await db.first<{ amount: number; mc_currency: string }>(
      "SELECT amount, mc_currency FROM zero_budgets WHERE month = 201701 AND category = 'rent'",
    );
    expect(january).toEqual({ amount: 190000, mc_currency: 'CAD' });
  });

  it('shows and edits the rates a month uses', async () => {
    await setupBudget();
    await setBudgetCurrency({
      month: '2016-12',
      category: 'rent',
      currency: 'CAD',
    });
    await db.update('zero_budgets', { id: '201612-rent', amount: 100000 });
    await batchUpdateTransactions({
      added: [
        {
          id: 'rent',
          account: 'eur',
          date: '2016-12-10',
          amount: -60000,
          category: 'rent',
        },
      ],
    });
    expect((await getTransaction('rent'))?.mc_budget_amount).toBe(-100000);

    expect(await getMonthRates({ month: '2016-12' })).toEqual([
      {
        base: 'CAD',
        quote: 'EUR',
        rate: 0.6,
        manual: false,
        // December's last week has no rate yet
        final: false,
      },
    ]);

    // A rate typed for the month re-converts what was converted with the
    // average
    await setMonthRate({
      month: '2016-12',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.5,
    });
    expect((await getTransaction('rent'))?.mc_budget_amount).toBe(-120000);
    await sheet.waitOnSpreadsheet();
    expect(cell(DECEMBER, 'group-budget-group')).toBe(50000);

    // Back to the average
    await setMonthRate({
      month: '2016-12',
      base: 'CAD',
      quote: 'EUR',
      rate: null,
    });
    expect((await getTransaction('rent'))?.mc_budget_amount).toBe(-100000);
  });

  it('follows the average of a month that is still going', async () => {
    await setupBudget();
    await setManualRate({
      date: '2017-01-01',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.62,
    });
    await batchUpdateTransactions({
      added: [
        {
          id: 'coffee',
          account: 'cad',
          date: '2017-01-01',
          amount: 0,
          mc_amount: -1000,
        },
      ],
    });
    expect((await getTransaction('coffee'))?.amount).toBe(-620);

    // Another rate comes in for the same days: the average moves
    await setManualRate({
      date: '2017-01-01',
      base: 'EUR',
      quote: 'CAD',
      rate: 1 / 0.64,
    });
    await db.delete_('mc_exchange_rates', '20170101:CAD:EUR');
    const { updated } = await refreshMonthRates();
    expect(updated).toBe(1);
    expect((await getTransaction('coffee'))?.amount).toBe(-640);
  });

  it('counts an exchange rate adjustment as 0 in its account currency', async () => {
    await setupBudget();
    await setBudgetCurrency({
      month: '2016-12',
      category: 'rent',
      currency: 'CAD',
    });
    // Recorded by "Adjust to today's value": 0 CAD, 15 EUR
    await batchUpdateTransactions({
      added: [
        {
          id: 'adjust',
          account: 'cad',
          date: '2016-12-20',
          amount: 1500,
          mc_amount: 0,
          category: 'rent',
        },
      ],
    });
    expect(await getTransaction('adjust')).toEqual({
      amount: 1500,
      mc_amount: 0,
      mc_budget_amount: 0,
    });
    // ... and doesn't wait for a rate
    expect(await recomputePending()).toEqual({ updated: 0, stillPending: 0 });
  });
});
