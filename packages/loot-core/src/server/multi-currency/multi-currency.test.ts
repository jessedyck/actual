// [fork:mc D-004..D-006]
import type { MockInstance } from 'vitest';

import * as db from '#server/db';
import { batchUpdateTransactions } from '#server/transactions';
import type { TransactionEntity } from '#types/models';

import {
  getStartingBalanceAmounts,
  normalizeAccountCurrency,
  parseWorkaroundNote,
  recomputePending,
  setAccountCurrency,
} from './accounts';
import {
  ensureRates,
  getRate,
  getRatesAt,
  getStoredRate,
  setManualRate,
  storeRates,
} from './rates';

// The global test setup loads the rates module before a `vi.mock` here
// could apply, so intercept the network at `globalThis.fetch` instead. This
// also guarantees no test ever reaches the real API. Test dates are in 2016
// because `currentDay()` is pinned to 2017-01-01 under test.
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

async function enable({ online = false } = {}) {
  await setPref('flags.multiCurrency', 'true');
  await setPref('defaultCurrencyCode', 'EUR');
  await setPref('mcRatesOnline', online ? 'true' : 'false');
}

async function transferPayee(accountId: string): Promise<string> {
  const row = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [accountId],
  );
  return row?.id as string;
}

async function setupAccounts() {
  for (const [id, currency] of [
    ['eur', null],
    ['cad', 'CAD'],
    ['usd', 'USD'],
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
    base: 'USD',
    quote: 'EUR',
    rate: 0.9,
  });
}

async function getTransaction(id: string) {
  return db.first<{
    id: string;
    account: string;
    amount: number;
    mc_amount: number | null;
    transfer_id: string | null;
  }>(
    'SELECT id, account, amount, mc_amount, transfer_id FROM v_transactions WHERE id = ?',
    [id],
  );
}

function tx(fields: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: fields.id ?? `t-${Math.random().toString(36).slice(2)}`,
    account: 'cad',
    amount: 0,
    date: '2016-10-02',
    ...fields,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('exchange rates', () => {
  // [fork:mc D-015]
  it('looks up rates for report periods', async () => {
    await enable();
    await setManualRate({
      date: '2016-10-01',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.6,
    });
    await setManualRate({
      date: '2016-10-10',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.7,
    });
    expect(
      await getRatesAt('CAD', 'EUR', [
        '2016-09-15',
        '2016-10-05',
        '2016-10-31',
      ]),
    ).toEqual({
      // Before the first rate: the oldest one
      '2016-09-15': 0.6,
      '2016-10-05': 0.6,
      // Long after the last rate: still the newest one
      '2016-10-31': 0.7,
    });
    expect(await getRatesAt('EUR', 'CAD', ['2016-10-10'])).toEqual({
      '2016-10-10': 1 / 0.7,
    });
    expect(await getRatesAt('USD', 'JPY', ['2016-10-10'])).toEqual({
      '2016-10-10': null,
    });
    expect(await getRatesAt('EUR', 'EUR', ['2016-10-10'])).toEqual({
      '2016-10-10': 1,
    });
  });

  it('reuses a recent rate and inverts stored pairs', async () => {
    await storeRates(
      [{ date: '2016-10-02', base: 'EUR', quote: 'CAD', rate: 1.6 }],
      'frankfurter',
    );
    // Saturday and Sunday reuse Friday's rate
    expect(await getStoredRate('2016-10-04', 'EUR', 'CAD')).toEqual({
      rate: 1.6,
      date: '2016-10-02',
      source: 'frankfurter',
    });
    expect((await getStoredRate('2016-10-04', 'CAD', 'EUR'))?.rate).toBe(
      1 / 1.6,
    );
    // Too old to reuse
    expect(await getStoredRate('2016-10-12', 'EUR', 'CAD')).toBeNull();
  });

  it('never lets a fetched rate replace a manual one', async () => {
    await setManualRate({
      date: '2016-10-02',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.61,
    });
    await storeRates(
      [{ date: '2016-10-02', base: 'CAD', quote: 'EUR', rate: 0.65 }],
      'frankfurter',
    );
    expect(await getStoredRate('2016-10-02', 'CAD', 'EUR')).toMatchObject({
      rate: 0.61,
      source: 'manual',
    });
  });

  it('fetches a missing rate when online rates are on', async () => {
    await enable({ online: true });
    mockedFetch.mockResolvedValue(
      jsonResponse([
        { date: '2016-09-15', base: 'CAD', quote: 'EUR', rate: 0.63 },
      ]),
    );
    expect((await getRate('2016-09-15', 'CAD', 'EUR'))?.rate).toBe(0.63);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(mockedFetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      'https://api.frankfurter.dev/v2/rates',
    );
    expect(url.searchParams.get('base')).toBe('CAD');
    expect(url.searchParams.get('quotes')).toBe('EUR');
    expect(url.searchParams.get('date')).toBe('2016-09-15');

    // Served from the local cache the second time
    expect((await getRate('2016-09-15', 'CAD', 'EUR'))?.rate).toBe(0.63);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('stays offline when online rates are off', async () => {
    await enable({ online: false });
    expect(await getRate('2016-09-15', 'CAD', 'EUR')).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('fetches one range for many missing dates', async () => {
    await enable({ online: true });
    mockedFetch.mockResolvedValue(
      jsonResponse([
        { date: '2016-08-03', base: 'USD', quote: 'EUR', rate: 0.91 },
        { date: '2016-08-04', base: 'USD', quote: 'EUR', rate: 0.92 },
      ]),
    );
    await ensureRates('USD', 'EUR', ['2016-08-04', '2016-08-03', '2016-08-04']);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(mockedFetch.mock.calls[0][0]));
    expect(url.searchParams.get('from')).toBe('2016-07-27');
    expect(url.searchParams.get('to')).toBe('2016-08-04');
    expect((await getStoredRate('2016-08-04', 'USD', 'EUR'))?.rate).toBe(0.92);
  });

  it('survives a failed request', async () => {
    await enable({ online: true });
    mockedFetch.mockRejectedValue(new Error('offline'));
    expect(await getRate('2016-09-15', 'CAD', 'EUR')).toBeNull();
  });
});

describe('transaction conversions', () => {
  it('does nothing while the feature is off', async () => {
    await setupAccounts();
    await batchUpdateTransactions({
      added: [tx({ id: 'a', amount: -100, mc_amount: -1000 })],
    });
    expect(await getTransaction('a')).toMatchObject({
      amount: -100,
      mc_amount: -1000,
    });
  });

  it('derives whichever amount is missing on new transactions', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [
        tx({ id: 'a', mc_amount: -1000 }),
        tx({ id: 'b', amount: -600 }),
        tx({ id: 'c', account: 'eur', amount: -500, mc_amount: -999 }),
      ],
    });
    expect(await getTransaction('a')).toMatchObject({
      amount: -600,
      mc_amount: -1000,
    });
    expect(await getTransaction('b')).toMatchObject({
      amount: -600,
      mc_amount: -1000,
    });
    // Budget-currency accounts never keep an account-currency amount
    expect(await getTransaction('c')).toMatchObject({
      amount: -500,
      mc_amount: null,
    });
  });

  it('re-derives the budget amount only when the account amount changes', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [tx({ id: 'a', mc_amount: -1000 })],
    });

    await batchUpdateTransactions({
      updated: [{ id: 'a', mc_amount: -2000, amount: -600 }],
    });
    expect(await getTransaction('a')).toMatchObject({
      amount: -1200,
      mc_amount: -2000,
    });

    // Editing the budget amount alone is a manual override
    await batchUpdateTransactions({ updated: [{ id: 'a', amount: -1150 }] });
    expect(await getTransaction('a')).toMatchObject({
      amount: -1150,
      mc_amount: -2000,
    });
  });

  it('re-derives the account amount when moved to another currency', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [tx({ id: 'a', mc_amount: -1000 })],
    });
    await batchUpdateTransactions({ updated: [{ id: 'a', account: 'usd' }] });
    // 6.00 EUR at 0.9 EUR per USD = 6.67 USD
    expect(await getTransaction('a')).toMatchObject({
      amount: -600,
      mc_amount: -667,
    });
    await batchUpdateTransactions({ updated: [{ id: 'a', account: 'eur' }] });
    expect(await getTransaction('a')).toMatchObject({
      amount: -600,
      mc_amount: null,
    });
  });

  it('mirrors transfers from the budget currency and keeps the received amount', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [
        tx({
          id: 'out',
          account: 'eur',
          amount: -6000,
          payee: await transferPayee('cad'),
        }),
      ],
    });
    const out = await getTransaction('out');
    const mirrorId = out?.transfer_id as string;
    expect(await getTransaction(mirrorId)).toMatchObject({
      account: 'cad',
      amount: 6000,
      mc_amount: 10000,
    });

    // The bank actually credited 99.00 CAD: the budget value must not move
    await batchUpdateTransactions({
      updated: [{ id: mirrorId, mc_amount: 9900, amount: 6000 }],
    });
    expect(await getTransaction(mirrorId)).toMatchObject({
      amount: 6000,
      mc_amount: 9900,
    });
    expect((await getTransaction('out'))?.amount).toBe(-6000);
  });

  it('derives transfers between two foreign accounts from the sending side', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [
        tx({
          id: 'out',
          account: 'cad',
          mc_amount: -1000,
          payee: await transferPayee('usd'),
        }),
      ],
    });
    const mirrorId = (await getTransaction('out'))?.transfer_id as string;
    expect(await getTransaction('out')).toMatchObject({
      amount: -600,
      mc_amount: -1000,
    });
    expect(await getTransaction(mirrorId)).toMatchObject({
      amount: 600,
      mc_amount: 667,
    });

    // Correcting what arrived leaves the budget value alone
    await batchUpdateTransactions({
      updated: [{ id: mirrorId, mc_amount: 650 }],
    });
    expect(await getTransaction(mirrorId)).toMatchObject({
      amount: 600,
      mc_amount: 650,
    });

    // Changing what was sent re-derives and mirrors the budget value
    await batchUpdateTransactions({
      updated: [{ id: 'out', mc_amount: -2000 }],
    });
    expect((await getTransaction('out'))?.amount).toBe(-1200);
    expect(await getTransaction(mirrorId)).toMatchObject({
      amount: 1200,
      mc_amount: 650,
    });
  });

  it('keeps split children adding up to the parent', async () => {
    await enable();
    await setupAccounts();
    await setManualRate({
      date: '2016-10-02',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.6123,
    });
    await batchUpdateTransactions({
      added: [
        tx({ id: 'p', is_parent: true, mc_amount: -1000 }),
        tx({ id: 'c1', is_child: true, parent_id: 'p', mc_amount: -333 }),
        tx({ id: 'c2', is_child: true, parent_id: 'p', mc_amount: -333 }),
        tx({ id: 'c3', is_child: true, parent_id: 'p', mc_amount: -334 }),
      ],
    });
    const parent = await getTransaction('p');
    const children = await Promise.all(
      ['c1', 'c2', 'c3'].map(id => getTransaction(id)),
    );
    expect(parent?.amount).toBe(-612);
    expect(
      children.reduce((total, child) => total + (child?.amount ?? 0), 0),
    ).toBe(-612);
  });

  it('marks conversions without a rate as pending and fills them later', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [tx({ id: 'a', date: '2016-05-04', mc_amount: -1000 })],
    });
    expect(await getTransaction('a')).toMatchObject({
      amount: 0,
      mc_amount: -1000,
    });

    await setManualRate({
      date: '2016-05-04',
      base: 'CAD',
      quote: 'EUR',
      rate: 0.65,
    });
    expect(await recomputePending()).toEqual({ updated: 1, stillPending: 0 });
    expect((await getTransaction('a'))?.amount).toBe(-650);
  });
});

describe('account currency', () => {
  it('only stores a currency that differs from the budget currency', async () => {
    expect(await normalizeAccountCurrency('CAD')).toBeNull();
    await enable();
    expect(await normalizeAccountCurrency('CAD')).toBe('CAD');
    expect(await normalizeAccountCurrency('EUR')).toBeNull();
    expect(await normalizeAccountCurrency('cad')).toBeNull();
  });

  it('converts a starting balance typed in the account currency', async () => {
    await enable();
    await setupAccounts();
    expect(
      await getStartingBalanceAmounts({
        balance: 150.25,
        currency: 'CAD',
        date: '2016-10-03',
      }),
    ).toEqual({ amount: 9015, mc_amount: 15025 });
    expect(
      await getStartingBalanceAmounts({
        balance: 150.25,
        currency: null,
        date: '2016-10-03',
      }),
    ).toEqual({ amount: 15025 });
  });

  it('reads amounts written by the documented workaround', () => {
    expect(
      parseWorkaroundNote('52.43 AUD (FX rate: 0.65) • Lunch', 'AUD'),
    ).toBe(5243);
    expect(parseWorkaroundNote('-52.43 AUD (FX rate: 0.65)', 'AUD')).toBe(
      -5243,
    );
    expect(parseWorkaroundNote('52.43 AUD (FX rate: 0.65)', 'CAD')).toBeNull();
    expect(parseWorkaroundNote('Groceries', 'AUD')).toBeNull();
  });

  it('backfills account amounts when an account gets a currency', async () => {
    await enable();
    await setupAccounts();
    await batchUpdateTransactions({
      added: [
        tx({
          id: 'noted',
          account: 'eur',
          amount: -3409,
          notes: '-52.43 CAD (FX rate: 0.65) • Lunch',
        }),
        tx({ id: 'plain', account: 'eur', amount: -600 }),
      ],
    });
    expect(await setAccountCurrency({ id: 'eur', currency: 'CAD' })).toEqual({
      updated: 2,
      missingRates: 0,
    });
    expect(await getTransaction('noted')).toMatchObject({
      amount: -3409,
      mc_amount: -5243,
    });
    expect(await getTransaction('plain')).toMatchObject({
      amount: -600,
      mc_amount: -1000,
    });

    // Back to the budget currency clears them again
    await setAccountCurrency({ id: 'eur', currency: 'EUR' });
    expect((await getTransaction('noted'))?.mc_amount).toBeNull();
  });
});
