// [fork:mc D-017]
import type { MockInstance } from 'vitest';

import * as db from '#server/db';
import { insertRule } from '#server/transactions/transaction-rules';

import { previewDefaultCurrency, setDefaultCurrency } from './default-currency';
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

// A CAD budget file: a CAD chequing account, a EUR account recorded in CAD
// with the docs workaround, and an account that already has its own currency
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
    mc_budget_amount: number | null;
  }>(
    'SELECT id, amount, mc_amount, mc_budget_amount FROM v_transactions_internal_alive',
  );
  return Object.fromEntries(
    rows.map(row => [
      row.id,
      { amount: row.amount, mc: row.mc_amount, budget: row.mc_budget_amount },
    ]),
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

async function getHeld(month: string) {
  const row = await db.first<{ buffered: number }>(
    'SELECT buffered FROM zero_budget_months WHERE id = ?',
    [month],
  );
  return row?.buffered;
}

async function getAccountCurrency(id: string) {
  const row = await db.first<{ mc_currency: string | null }>(
    'SELECT mc_currency FROM accounts WHERE id = ?',
    [id],
  );
  return row?.mc_currency;
}

describe('changing the default currency', () => {
  it('suggests each account without a currency the one it holds', async () => {
    await setupBudget();
    await db.insertAccount({ id: 'named', name: 'Tokyo (JPY)' });
    await db.insertAccount({ id: 'noted', name: 'Savings' });
    await db.insert('notes', { id: 'account-noted', note: '#currency:USD' });

    const preview = await previewDefaultCurrency({ toCurrency: 'EUR' });
    const byId = Object.fromEntries(
      preview.accounts.map(account => [account.id, account]),
    );
    expect(preview.fromCurrency).toBe('CAD');
    expect(preview.todayRate).toBe(0.66);
    expect(preview.keepUntil).toBe('2017-01');
    // The budgets of October and December have no currency of their own
    expect(preview.unsetBudgets).toBe(3);
    expect(byId.chq).toMatchObject({
      currency: null,
      suggested: 'CAD',
      reason: 'current',
    });
    expect(byId.eur).toMatchObject({
      currency: null,
      suggested: 'EUR',
      reason: 'transaction-notes',
      transactions: 4,
      notedTransactions: 3,
    });
    expect(byId.gbp).toMatchObject({ currency: 'GBP', reason: 'current' });
    expect(byId.named).toMatchObject({
      suggested: 'JPY',
      reason: 'account-name',
    });
    expect(byId.noted).toMatchObject({
      suggested: 'USD',
      reason: 'account-note',
    });
    expect(preview.workaroundRules).toEqual([
      { id: 'workaround', accountIds: ['eur'], accounts: ['Livret'] },
    ]);
  });

  it('keeps past budgets as they were', async () => {
    await setupBudget();
    const result = await setDefaultCurrency({
      toCurrency: 'EUR',
      accountCurrencies: { chq: 'CAD', eur: 'EUR' },
      keepBudgets: true,
    });
    const rows = await getTransactions();

    // CAD stays CAD; its value in EUR is at its month's rate
    expect(rows.c1).toEqual({ amount: -7000, mc: -10000, budget: null });
    // The December budgets stay in CAD and count what they counted
    expect(rows.bill).toEqual({ amount: -66000, mc: -100000, budget: -100000 });
    expect(rows.groceries).toEqual({ amount: -2640, mc: -4000, budget: -4000 });
    // The workaround account's amounts come from its notes, or at the
    // month's rate
    expect(rows.e1).toEqual({ amount: -5243, mc: null, budget: null });
    expect(rows.e2).toEqual({ amount: -680, mc: null, budget: null });
    // Transfers mirror; the EUR side decides
    expect(rows.t2).toEqual({ amount: 33950, mc: null, budget: null });
    expect(rows.t1).toEqual({ amount: -33950, mc: -50000, budget: null });
    // Splits add up
    expect(rows.p.amount).toBe(
      rows.p1.amount + rows.p2.amount + rows.p3.amount,
    );
    expect(rows.q).toEqual({ amount: -2000, mc: null, budget: null });
    expect([rows.q1.amount, rows.q2.amount]).toEqual([-667, -1333]);
    // GBP stays GBP
    expect(rows.g1).toEqual({ amount: -1150, mc: -1000, budget: null });

    expect(await getAccountCurrency('chq')).toBe('CAD');
    expect(await getAccountCurrency('eur')).toBeNull();
    expect(await getAccountCurrency('gbp')).toBe('GBP');

    // Budget amounts don't change
    const budgets = await db.all<{ id: string; amount: number }>(
      'SELECT id, amount FROM zero_budgets ORDER BY id',
    );
    expect(budgets).toEqual([
      { id: '201610-food', amount: 50000 },
      { id: '201612-food', amount: 10000 },
      { id: '201612-rent', amount: 100000 },
      { id: '201702-food', amount: 10000 },
    ]);
    // Money held for next month is in the default currency: November's
    // average rate
    expect(await getHeld('2016-11')).toBe(13600);

    expect(await getPref('defaultCurrencyCode')).toBe('EUR');
    expect(JSON.parse((await getPref('mcCurrencyPeriods')) as string)).toEqual([
      { currency: 'CAD', until: '2017-01' },
    ]);
    expect(await getPref('mcReportCurrency')).toBe('');
    expect(await getPref('numberFormat')).toBe('dot-comma');

    // The workaround rule converted amounts into CAD; it goes
    expect((await getRule('workaround'))?.tombstone).toBe(1);
    // Rules for every account keep their amounts
    expect((await getRule('rent'))?.conditions[0].value).toBe(-150000);
    expect(result).toMatchObject({ deletedRules: 1, rules: 0 });
  });

  it('lets accounts and budgets without a currency follow', async () => {
    await setupBudget();
    await setDefaultCurrency({
      toCurrency: 'EUR',
      accountCurrencies: {},
      keepBudgets: false,
    });
    const rows = await getTransactions();
    // The chequing account follows the default currency: same numbers
    expect(rows.c1).toEqual({ amount: -10000, mc: null, budget: null });
    expect(rows.bill).toEqual({ amount: -100000, mc: null, budget: null });
    expect(await getAccountCurrency('chq')).toBeNull();
    expect(await getPref('mcCurrencyPeriods')).toBeUndefined();
    // Like the budgets, money held keeps its number
    expect(await getHeld('2016-11')).toBe(20000);
    // The workaround account follows too: its rule, converting into CAD,
    // goes
    expect((await getRule('workaround'))?.tombstone).toBe(1);
  });

  // [fork:mc D-018]
  it("converts a rule's amounts into its account's new currency", async () => {
    await setupBudget();
    await setManualRate({
      date: '2016-10-01',
      base: 'CAD',
      quote: 'JPY',
      rate: 80,
    });
    await rate('2016-10-01', 'JPY', 0.0085);
    await insertRule({
      id: 'mortgage',
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'is', field: 'account', value: 'chq' },
        { op: 'is', field: 'amount', value: -150000 },
      ],
      actions: [{ op: 'set', field: 'category', value: 'rent' }],
    });

    const result = await setDefaultCurrency({
      toCurrency: 'EUR',
      accountCurrencies: { chq: 'JPY', eur: 'EUR' },
      keepBudgets: true,
    });
    // 1.500,00 CAD is 120.000 JPY at today's rate; rule amounts count
    // hundredths whatever the currency
    expect((await getRule('mortgage'))?.conditions[1].value).toBe(-12000000);
    // Rules for every account keep their amounts
    expect((await getRule('rent'))?.conditions[0].value).toBe(-150000);
    expect(result).toMatchObject({ rules: 1 });
  });

  it('refuses without a rate or a valid currency', async () => {
    await setupBudget();
    await expect(
      setDefaultCurrency({
        toCurrency: 'EUR',
        accountCurrencies: { chq: 'XYZ' },
        keepBudgets: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        type: 'APIError',
        message: expect.stringMatching(/Invalid currency/),
      }),
    );
    await expect(
      setDefaultCurrency({
        toCurrency: 'CAD',
        accountCurrencies: {},
        keepBudgets: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/already CAD/),
      }),
    );
    await expect(
      setDefaultCurrency({
        toCurrency: 'GBP',
        accountCurrencies: { chq: 'CAD' },
        keepBudgets: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/No exchange rate/),
      }),
    );
    // Nothing changed
    expect(await getPref('defaultCurrencyCode')).toBe('CAD');
  });
});
