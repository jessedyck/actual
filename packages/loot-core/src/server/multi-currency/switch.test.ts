// [fork:mc D-016]
import type { MockInstance } from 'vitest';

import * as db from '#server/db';
import { insertRule } from '#server/transactions/transaction-rules';

import { setManualRate } from './rates';
import { previewCurrencySwitch, switchBudgetCurrency } from './switch';

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

async function getPref(id: string) {
  const row = await db.first<{ value: string }>(
    'SELECT value FROM preferences WHERE id = ?',
    [id],
  );
  return row?.value;
}

async function rate(date: string, base: string, value: number) {
  await setManualRate({ date, base, quote: 'EUR', rate: value });
}

// A CAD budget: a CAD chequing account, a EUR account recorded in CAD with
// the docs workaround, and an account that already has its own currency
async function setupBudget() {
  await setPref('flags.multiCurrency', 'true');
  await setPref('defaultCurrencyCode', 'CAD');
  await setPref('mcRatesOnline', 'false');
  await setPref('mcReportCurrency', 'EUR');

  await db.insertAccount({ id: 'chq', name: 'Chequing' });
  await db.insertAccount({ id: 'eur', name: 'Livret' });
  await db.insertAccount({ id: 'gbp', name: 'London', mc_currency: 'GBP' });
  await db.insertCategoryGroup({ id: 'group', name: 'Expenses' });
  await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'group' });
  await db.insertCategory({ id: 'rent', name: 'Rent', cat_group: 'group' });

  await rate('2016-10-01', 'CAD', 0.7);
  await rate('2016-11-01', 'CAD', 0.68);
  await rate('2016-12-15', 'CAD', 0.66);
  await rate('2016-10-01', 'GBP', 1.15);

  const transactions = [
    { id: 'c1', account: 'chq', amount: -10000, date: '2016-10-05' },
    // December: rent spent exactly as budgeted, food partly
    {
      id: 'bill',
      account: 'chq',
      amount: -100000,
      date: '2016-12-20',
      category: 'rent',
    },
    {
      id: 'groceries',
      account: 'chq',
      amount: -4000,
      date: '2016-12-20',
      category: 'food',
    },
    {
      id: 'e1',
      account: 'eur',
      amount: -7865,
      date: '2016-10-06',
      notes: '-52.43 EUR (FX rate: 1.5) • Lunch',
    },
    { id: 'e2', account: 'eur', amount: -1000, date: '2016-11-02' },
    // A transfer whose EUR side was converted with the workaround
    {
      id: 't1',
      account: 'chq',
      amount: -50000,
      date: '2016-11-03',
      transfer_id: 't2',
    },
    {
      id: 't2',
      account: 'eur',
      amount: 50000,
      date: '2016-11-03',
      transfer_id: 't1',
      notes: '339.50 EUR (FX rate: 1.4728)',
    },
    // A split in CAD
    {
      id: 'p',
      account: 'chq',
      amount: -1001,
      date: '2016-12-20',
      is_parent: true,
    },
    ...[-333, -334, -334].map((amount, index) => ({
      id: `p${index + 1}`,
      account: 'chq',
      amount,
      date: '2016-12-20',
      is_child: true,
      parent_id: 'p',
    })),
    // A split in the workaround account: the note gives the EUR total
    {
      id: 'q',
      account: 'eur',
      amount: -3000,
      date: '2016-11-10',
      is_parent: true,
      notes: '-20.00 EUR (FX rate: 1.5)',
    },
    ...[-1000, -2000].map((amount, index) => ({
      id: `q${index + 1}`,
      account: 'eur',
      amount,
      date: '2016-11-10',
      is_child: true,
      parent_id: 'q',
    })),
    {
      id: 'g1',
      account: 'gbp',
      amount: -1700,
      mc_amount: -1000,
      date: '2016-10-07',
    },
  ];
  for (const transaction of transactions) {
    await db.insertTransaction(transaction);
  }

  await db.insert('zero_budgets', {
    id: '201610-food',
    month: 201610,
    category: 'food',
    amount: 50000,
    goal: 60000,
    long_goal: 1,
  });
  await db.insert('zero_budgets', {
    id: '201612-food',
    month: 201612,
    category: 'food',
    amount: 10000,
  });
  await db.insert('zero_budgets', {
    id: '201612-rent',
    month: 201612,
    category: 'rent',
    amount: 100000,
  });
  await db.insert('zero_budgets', {
    id: '201702-food',
    month: 201702,
    category: 'food',
    amount: 10000,
  });
  await db.insert('zero_budget_months', { id: '2016-11', buffered: 20000 });

  // The docs workaround's rule, and rules with amounts
  await insertRule({
    id: 'workaround',
    stage: 'post',
    conditionsOp: 'and',
    conditions: [
      { op: 'is', field: 'account', value: 'eur' },
      { op: 'doesNotContain', field: 'notes', value: 'FX rate:' },
    ],
    actions: [
      {
        op: 'set',
        field: 'notes',
        value: null,
        options: {
          template:
            '{{ fixed (div amount 100) 2 }} EUR (FX rate: 1.5) • {{ notes }}',
        },
      },
      {
        op: 'set',
        field: 'amount',
        value: null,
        options: { template: '{{ fixed (mul amount 1.5) 0 }}' },
      },
    ],
  });
  await insertRule({
    id: 'rent',
    stage: null,
    conditionsOp: 'and',
    conditions: [{ op: 'isapprox', field: 'amount', value: -150000 }],
    actions: [{ op: 'set', field: 'category', value: 'housing' }],
  });
  await insertRule({
    id: 'range',
    stage: null,
    conditionsOp: 'and',
    conditions: [
      {
        op: 'isbetween',
        field: 'amount',
        value: { num1: -10000, num2: -5000 },
      },
    ],
    actions: [{ op: 'set', field: 'amount', value: -2000 }],
  });
  await insertRule({
    id: 'payee',
    stage: null,
    conditionsOp: 'and',
    conditions: [{ op: 'is', field: 'imported_payee', value: 'shop' }],
    actions: [{ op: 'set', field: 'category', value: 'food' }],
  });
}

async function getTransactions() {
  const rows = await db.all<{
    id: string;
    amount: number;
    mc_amount: number | null;
  }>('SELECT id, amount, mc_amount FROM v_transactions_internal_alive');
  return Object.fromEntries(
    rows.map(row => [row.id, { amount: row.amount, mc: row.mc_amount }]),
  );
}

async function getRule(id: string) {
  const row = await db.first<db.DbRule>('SELECT * FROM rules WHERE id = ?', [
    id,
  ]);
  return (
    row && {
      tombstone: row.tombstone,
      conditions: JSON.parse(row.conditions),
      actions: JSON.parse(row.actions),
    }
  );
}

describe('changing the budget currency', () => {
  it('suggests each account its currency', async () => {
    await setupBudget();
    await db.insertAccount({ id: 'named', name: 'Tokyo (JPY)' });
    await db.insertAccount({ id: 'noted', name: 'Savings' });
    await db.insert('notes', { id: 'account-noted', note: '#currency:USD' });

    const preview = await previewCurrencySwitch({ toCurrency: 'EUR' });
    expect(preview).toMatchObject({
      fromCurrency: 'CAD',
      toCurrency: 'EUR',
      todayRate: 0.66,
      // A split counts once
      transactions: 10,
      firstDate: '2016-10-05',
      budgetMonths: 3,
      rulesWithAmounts: 2,
      workaroundRules: [{ id: 'workaround', accounts: ['Livret'] }],
    });
    const byId = Object.fromEntries(
      preview.accounts.map(account => [account.id, account]),
    );
    expect(byId.chq).toMatchObject({
      currency: 'CAD',
      suggested: 'CAD',
      reason: 'current',
      transactions: 5,
    });
    expect(byId.eur).toMatchObject({
      currency: 'CAD',
      suggested: 'EUR',
      reason: 'transaction-notes',
      transactions: 4,
      notedTransactions: 3,
    });
    expect(byId.gbp).toMatchObject({ currency: 'GBP', suggested: 'GBP' });
    expect(byId.named).toMatchObject({
      suggested: 'JPY',
      reason: 'account-name',
    });
    expect(byId.noted).toMatchObject({
      suggested: 'USD',
      reason: 'account-note',
    });
  });

  it('converts the history at each date', async () => {
    await setupBudget();
    const result = await switchBudgetCurrency({
      toCurrency: 'EUR',
      accountCurrencies: { chq: 'CAD', eur: 'EUR', gbp: 'GBP' },
    });
    expect(result).toEqual({
      transactions: 15,
      budgets: 4,
      rules: 2,
      deletedRules: 1,
    });

    const transactions = await getTransactions();
    // Chequing keeps its CAD amounts and gets EUR ones at the day's rate
    expect(transactions.c1).toEqual({ amount: -7000, mc: -10000 });
    // The workaround account takes its amounts from the notes, or converts
    expect(transactions.e1).toEqual({ amount: -5243, mc: null });
    expect(transactions.e2).toEqual({ amount: -680, mc: null });
    // The EUR side of a transfer decides both budget amounts
    expect(transactions.t2).toEqual({ amount: 33950, mc: null });
    expect(transactions.t1).toEqual({ amount: -33950, mc: -50000 });
    // Splits still add up
    expect([1, 2, 3].map(index => transactions[`p${index}`].mc)).toEqual([
      -333, -334, -334,
    ]);
    expect(transactions.p.mc).toBe(-1001);
    expect(transactions.p.amount).toBe(
      [1, 2, 3].reduce(
        (total, index) => total + transactions[`p${index}`].amount,
        0,
      ),
    );
    expect(transactions.q).toEqual({ amount: -2000, mc: null });
    expect(transactions.q1).toEqual({ amount: -667, mc: null });
    expect(transactions.q2).toEqual({ amount: -1333, mc: null });
    // An account with its own currency keeps its amounts
    expect(transactions.g1).toEqual({ amount: -1150, mc: -1000 });

    const accounts = await db.all<{ id: string; mc_currency: string | null }>(
      'SELECT id, mc_currency FROM accounts ORDER BY id',
    );
    expect(accounts).toEqual([
      { id: 'chq', mc_currency: 'CAD' },
      { id: 'eur', mc_currency: null },
      { id: 'gbp', mc_currency: 'GBP' },
    ]);

    // Budgets at the month's average rate, future months at today's
    const budgets = await db.all<{
      id: string;
      amount: number;
      goal: number | null;
      long_goal: number | null;
    }>('SELECT id, amount, goal, long_goal FROM zero_budgets ORDER BY id');
    expect(budgets).toEqual([
      { id: '201610-food', amount: 35000, goal: 42000, long_goal: 1 },
      // The 40.00 spent at its day's 0.66, the other 60.00 at the month's
      // average: 14 days at 0.68 and 17 at 0.66
      { id: '201612-food', amount: 6654, goal: null, long_goal: null },
      // Spent exactly as budgeted: still exactly spent
      { id: '201612-rent', amount: 66000, goal: null, long_goal: null },
      { id: '201702-food', amount: 6600, goal: null, long_goal: null },
    ]);
    expect(transactions.bill.amount).toBe(-66000);
    expect(await db.first('SELECT buffered FROM zero_budget_months')).toEqual({
      buffered: 13600,
    });

    // Rules at today's rate; the workaround's rule is gone
    expect((await getRule('rent'))?.conditions[0].value).toBe(-99000);
    expect(await getRule('range')).toMatchObject({
      conditions: [{ value: { num1: -6600, num2: -3300 } }],
      actions: [{ value: -1320 }],
    });
    expect((await getRule('payee'))?.conditions[0].value).toBe('shop');
    expect((await getRule('workaround'))?.tombstone).toBe(1);

    // The new currency's formats, as the currency setting would set them
    expect(await getPref('defaultCurrencyCode')).toBe('EUR');
    expect(await getPref('numberFormat')).toBe('dot-comma');
    expect(await getPref('currencySymbolPosition')).toBe('after');
    expect(await getPref('mcReportCurrency')).toBe('');
  });

  it('keeps accounts that are left out in their currency', async () => {
    await setupBudget();
    await switchBudgetCurrency({ toCurrency: 'EUR', accountCurrencies: {} });
    const transactions = await getTransactions();
    // The workaround account stays in CAD: its notes are not read
    expect(transactions.e1).toEqual({ amount: -5506, mc: -7865 });
    expect(transactions.g1).toEqual({ amount: -1150, mc: -1000 });
  });

  it('refuses without a rate or a valid currency', async () => {
    await setupBudget();
    // Handlers reject with API errors: plain objects the client shows as is
    const refusal = (pattern: RegExp) =>
      expect.objectContaining({
        type: 'APIError',
        message: expect.stringMatching(pattern),
      });
    await expect(previewCurrencySwitch({ toCurrency: 'CAD' })).rejects.toEqual(
      refusal(/already in CAD/),
    );
    await expect(
      switchBudgetCurrency({ toCurrency: 'USD', accountCurrencies: {} }),
    ).rejects.toEqual(refusal(/No exchange rate from \w+ to USD/));
    await expect(
      switchBudgetCurrency({
        toCurrency: 'EUR',
        accountCurrencies: { chq: 'XYZ' },
      }),
    ).rejects.toEqual(refusal(/Invalid currency/));
    // Nothing changed
    expect(await getPref('defaultCurrencyCode')).toBe('CAD');
    expect((await getTransactions()).c1).toEqual({
      amount: -10000,
      mc: null,
    });
  });
});
