// [fork:mc D-008]
import type { MockInstance } from 'vitest';

import { reconcileTransactions } from '#server/accounts/sync';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { batchUpdateTransactions } from '#server/transactions';
import { loadRules } from '#server/transactions/transaction-rules';

import { getImportAmountMatch } from './imports';
import { setManualRate } from './rates';

// Test dates are in 2016 because `currentDay()` is pinned to 2017-01-01
// under test. No test may reach the network.
let mockedFetch: MockInstance<typeof globalThis.fetch>;

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  mockedFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network request'));

  for (const [id, value] of [
    ['flags.multiCurrency', 'true'],
    ['defaultCurrencyCode', 'EUR'],
    ['mcRatesOnline', 'false'],
  ]) {
    await db.update('preferences', { id, value });
  }
  for (const [id, currency] of [
    ['eur', null],
    ['cad', 'CAD'],
    ['jpy', 'JPY'],
  ] as const) {
    await db.insertAccount({
      id,
      name: id,
      ...(currency ? { mc_currency: currency } : {}),
    });
    await db.insertPayee({ name: '', transfer_acct: id });
  }
  await setManualRate({
    date: '2016-10-01',
    base: 'CAD',
    quote: 'EUR',
    rate: 0.6,
  });
  await setManualRate({
    date: '2016-10-01',
    base: 'JPY',
    quote: 'EUR',
    rate: 0.006,
  });
});

afterEach(() => {
  mockedFetch.mockRestore();
});

async function rows(account: string) {
  return db.all<{
    amount: number;
    mc_amount: number | null;
    imported_id: string | null;
    notes: string | null;
  }>(
    'SELECT amount, mc_amount, imported_id, notes FROM v_transactions WHERE account = ? ORDER BY sort_order DESC',
    [account],
  );
}

describe('imports into foreign-currency accounts', () => {
  it('reads imported amounts in the account currency', async () => {
    const result = await reconcileTransactions('cad', [
      { date: '2016-10-02', amount: -1050, payee_name: 'Shop', notes: 'a' },
      { date: '2016-10-03', amount: 2000, payee_name: 'Employer', notes: 'b' },
    ]);
    expect(result.added).toHaveLength(2);
    expect(await rows('cad')).toEqual([
      { amount: -630, mc_amount: -1050, imported_id: null, notes: 'a' },
      { amount: 1200, mc_amount: 2000, imported_id: null, notes: 'b' },
    ]);
  });

  it('counts yen in hundredths, like every imported amount', async () => {
    await reconcileTransactions('jpy', [
      { date: '2016-10-02', amount: -150000, payee_name: 'Lawson' },
    ]);
    expect(await rows('jpy')).toEqual([
      { amount: -900, mc_amount: -1500, imported_id: null, notes: null },
    ]);
  });

  it('leaves budget-currency accounts alone', async () => {
    await reconcileTransactions('eur', [
      { date: '2016-10-02', amount: -1050, payee_name: 'Shop' },
    ]);
    expect(await rows('eur')).toEqual([
      { amount: -1050, mc_amount: null, imported_id: null, notes: null },
    ]);
  });

  it('keeps both amounts when the caller sends them', async () => {
    await reconcileTransactions('cad', [
      { date: '2016-10-02', amount: -700, mc_amount: -1050, payee_name: 'X' },
    ]);
    expect((await rows('cad'))[0]).toMatchObject({
      amount: -700,
      mc_amount: -1050,
    });
  });

  it('leaves the conversion pending without a rate', async () => {
    await reconcileTransactions('cad', [
      { date: '2016-09-01', amount: -1050, payee_name: 'Shop' },
    ]);
    expect((await rows('cad'))[0]).toMatchObject({
      amount: 0,
      mc_amount: -1050,
    });
  });

  it('matches existing transactions on the account amount', async () => {
    // Entered by hand with the amount the bank actually charged in euros,
    // which differs from the rate's conversion
    await batchUpdateTransactions({
      added: [
        {
          id: 'manual',
          account: 'cad',
          date: '2016-10-02',
          amount: -1195,
          mc_amount: -2000,
          notes: 'manual',
        },
      ],
    });

    const preview = await reconcileTransactions(
      'cad',
      [
        {
          date: '2016-10-03',
          amount: -2000,
          payee_name: 'Shop',
          imported_id: 'bank-1',
        },
      ],
      { isPreview: true },
    );
    // Shown in the account currency, like the file's amounts
    expect(preview.updatedPreview[0].existing?.amount).toBe(-20);

    const result = await reconcileTransactions('cad', [
      {
        date: '2016-10-03',
        amount: -2000,
        payee_name: 'Shop',
        imported_id: 'bank-1',
      },
    ]);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toEqual(['manual']);
    expect(await rows('cad')).toEqual([
      {
        amount: -1195,
        mc_amount: -2000,
        imported_id: 'bank-1',
        notes: 'manual',
      },
    ]);
  });

  it('builds upstream conditions for other accounts', () => {
    expect(getImportAmountMatch({ amount: -500 }, null)).toEqual({
      sql: 'amount = ?',
      params: [-500],
    });
    expect(
      getImportAmountMatch({ amount: -300, mc_amount: -500 }, 'CAD'),
    ).toEqual({
      sql: '(mc_amount = ? OR (mc_amount IS NULL AND amount = ?))',
      params: [-500, -300],
    });
    expect(getImportAmountMatch({ amount: 0, mc_amount: -500 }, 'CAD')).toEqual(
      { sql: 'mc_amount = ?', params: [-500] },
    );
  });
});
