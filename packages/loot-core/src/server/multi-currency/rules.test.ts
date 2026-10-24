// [fork:mc D-018]
import MockDate from 'mockdate';
import type { MockInstance } from 'vitest';

import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { generateForecast } from '#server/forecast/app';
import { createSchedule, app as schedulesApp } from '#server/schedules/app';
import { batchUpdateTransactions } from '#server/transactions';
import {
  applyActions,
  conditionsToAQL,
  insertRule,
  loadRules,
  runRules,
} from '#server/transactions/transaction-rules';
import { q } from '#shared/query';

import { setManualRate } from './rates';

// Test dates are in 2016 because `currentDay()` is pinned to 2017-01-01
// under test; the network is never reached.
let mockedFetch: MockInstance<typeof globalThis.fetch>;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});
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

// A EUR budget file with a CAD account; 1 CAD = 0.6 EUR in October 2016
async function setup() {
  await setPref('flags.multiCurrency', 'true');
  await setPref('defaultCurrencyCode', 'EUR');
  await setPref('mcRatesOnline', 'false');
  await setManualRate({
    date: '2016-10-01',
    base: 'CAD',
    quote: 'EUR',
    rate: 0.6,
  });
  await db.insertAccount({ id: 'cad', name: 'Chequing', mc_currency: 'CAD' });
  await db.insertAccount({ id: 'eur', name: 'Compte' });
  await db.insertCategoryGroup({ id: 'group', name: 'Bills' });
  await db.insertCategory({
    id: 'housing',
    name: 'Housing',
    cat_group: 'group',
  });
}

async function getTransaction(id: string) {
  return db.first<{ amount: number; mc_amount: number | null }>(
    'SELECT amount, mc_amount FROM v_transactions_internal_alive WHERE id = ?',
    [id],
  );
}

describe('amounts in the account currency', () => {
  it('compares and sets amounts in the account currency', async () => {
    await setup();
    // The mortgage is 1.900,00 CAD
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'amount', value: -190000 }],
      actions: [{ op: 'set', field: 'category', value: 'housing' }],
    });
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'fee' }],
      actions: [{ op: 'set', field: 'amount', value: -500 }],
    });

    const mortgage = await runRules({
      id: 'm',
      account: 'cad',
      date: '2016-10-05',
      amount: -114000,
      mc_amount: -190000,
    });
    expect(mortgage).toMatchObject({
      category: 'housing',
      amount: -114000,
      mc_amount: -190000,
    });

    // 5,00 CAD is 3,00 EUR in October
    const fee = await runRules({
      id: 'f',
      account: 'cad',
      date: '2016-10-05',
      imported_payee: 'fee',
      amount: -1200,
      mc_amount: -2000,
    });
    expect(fee).toMatchObject({ amount: -300, mc_amount: -500 });

    // An account in the default currency compares its own amount, as before
    const eur = await runRules({
      id: 'e',
      account: 'eur',
      date: '2016-10-05',
      amount: -190000,
    });
    expect(eur).toMatchObject({ category: 'housing', amount: -190000 });
  });

  it('splits the account currency amount', async () => {
    await setup();
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'imported_payee', value: 'shop' }],
      actions: [
        {
          op: 'set-split-amount',
          value: -500,
          options: { splitIndex: 1, method: 'fixed-amount' },
        },
        {
          op: 'set-split-amount',
          value: null,
          options: { splitIndex: 2, method: 'remainder' },
        },
      ],
    });

    // 20,00 CAD split into 5,00 and 15,00 CAD: 3,00 and 9,00 EUR
    const split = await runRules({
      id: 's',
      account: 'cad',
      date: '2016-10-05',
      imported_payee: 'shop',
      amount: -1200,
      mc_amount: -2000,
    });
    expect(split).toMatchObject({
      amount: -1200,
      mc_amount: -2000,
      subtransactions: [
        { amount: -300, mc_amount: -500 },
        { amount: -900, mc_amount: -1500 },
      ],
    });
  });

  it('filters by the account currency amount', async () => {
    await setup();
    // An account storing the default currency (D-012)
    await db.insertAccount({ id: 'own', name: 'Livret', mc_currency: 'EUR' });
    await batchUpdateTransactions({
      added: [
        {
          id: 'm',
          account: 'cad',
          date: '2016-10-05',
          amount: 0,
          mc_amount: -190000,
        },
        { id: 'e', account: 'eur', date: '2016-10-05', amount: -190000 },
        { id: 'x', account: 'eur', date: '2016-10-06', amount: -114000 },
        { id: 'o', account: 'own', date: '2016-10-07', amount: -190000 },
      ],
    });
    const { filters } = conditionsToAQL([
      { op: 'is', field: 'amount', value: -190000, type: 'number' },
    ]);
    const { data } = await aqlQuery(
      q('transactions').filter({ $and: filters }).select(['id']).orderBy('id'),
    );
    expect(data.map((row: { id: string }) => row.id)).toEqual(['e', 'm', 'o']);
  });

  it("applies actions to the account's own amount", async () => {
    await setup();
    await batchUpdateTransactions({
      added: [
        {
          id: 'm',
          account: 'cad',
          date: '2016-10-05',
          amount: 0,
          mc_amount: -190000,
        },
      ],
    });
    const { data } = await aqlQuery(
      q('transactions').filter({ id: 'm' }).select('*'),
    );
    await applyActions(data, [
      { op: 'set', field: 'amount', value: -200000, type: 'number' },
    ]);
    expect(await getTransaction('m')).toEqual({
      amount: -120000,
      mc_amount: -200000,
    });
  });

  it("posts a schedule's amount in its account currency", async () => {
    await setup();
    const id = await createSchedule({
      schedule: { name: 'Mortgage', posts_transaction: false },
      conditions: [
        { op: 'is', field: 'account', value: 'cad' },
        { op: 'is', field: 'amount', value: -190000 },
        {
          op: 'is',
          field: 'date',
          value: {
            start: '2016-10-15',
            frequency: 'monthly',
            patterns: [],
          },
        },
      ],
    });
    await loadRules();
    // The service tracks where a schedule's account and amount are
    schedulesApp.startServices();
    try {
      await schedulesApp.handlers['schedule/post-transaction']({ id });
    } finally {
      await schedulesApp.stopServices();
    }

    const { data } = await aqlQuery(
      q('transactions')
        .filter({ schedule: id })
        .select(['amount', 'mc_amount']),
    );
    // 1.900,00 CAD, worth 1.140,00 EUR in October
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ amount: -114000, mc_amount: -190000 });
  });
  it("forecasts a schedule's amount at its month's rate", async () => {
    MockDate.set(new Date(2017, 0, 1, 12));
    try {
      await setup();
      await createSchedule({
        schedule: { name: 'Mortgage', posts_transaction: false },
        conditions: [
          { op: 'is', field: 'account', value: 'cad' },
          { op: 'is', field: 'amount', value: -190000 },
          {
            op: 'is',
            field: 'date',
            value: {
              start: '2017-01-15',
              frequency: 'monthly',
              patterns: [],
            },
          },
        ],
      });
      const result = await generateForecast({
        accountIds: ['cad'],
        startDate: '2017-01-01',
        endDate: '2017-01-31',
      });
      const balanceByDate = Object.fromEntries(
        result.dataPoints.map(({ date, balance }) => [date, balance]),
      );
      // 1.900,00 CAD is worth 1.140,00 EUR at the latest month's rate
      expect(balanceByDate['2017-01-14']).toBe(0);
      expect(balanceByDate['2017-01-15']).toBe(-114000);
    } finally {
      MockDate.reset();
    }
  });
});
