// [fork:mc D-004] Exchange-rate storage and lookup.
//
// Lookup order for a (date, base, quote):
//   1. the synced `mc_exchange_rates` table, reusing the latest rate up to
//      RATE_CARRY_FORWARD_DAYS before the date (weekends, holidays);
//   2. Frankfurter, when online rates are enabled; results are stored;
//   3. nothing: callers treat the conversion as pending.
// Future dates are looked up as today, since no future rates exist.
import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { withMutatorContext } from '#server/mutators';
import { batchMessages } from '#server/sync';
import * as monthUtils from '#shared/months';
import {
  convertMinorUnits,
  DEFAULT_RATES_URL,
  isCurrencyCode,
  makeRateId,
  MC_PREF_RATES_ONLINE,
  MC_PREF_RATES_URL,
  RATE_CARRY_FORWARD_DAYS,
} from '#shared/multi-currency';
import type { McExchangeRateEntity } from '#types/models';

import { fetchRates } from './frankfurter';
import type { FetchedRate } from './frankfurter';

export type RateSource = 'frankfurter' | 'manual';

export type RateLookup = {
  rate: number;
  date: string;
  source: string | null;
};

export type RateSettings = { online: boolean; url: string };

export type MultiCurrencyContext = {
  enabled: boolean;
  /**
   * The default currency of the budget file, also the currency of budgets
   * without one of their own (D-017)
   */
  budgetCurrency: string;
};

const SQL_CHUNK_SIZE = 400;

async function getPref(id: string): Promise<string | undefined> {
  const row = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    [id],
  );
  return row?.value ?? undefined;
}

/**
 * The feature is active only with its flag on and a budget currency set;
 * without a budget currency there is nothing to convert to. One query, since
 * this runs on every transaction write.
 */
export async function getMultiCurrencyContext(): Promise<MultiCurrencyContext> {
  const rows = await db.all<Pick<db.DbPreference, 'id' | 'value'>>(
    `SELECT id, value FROM preferences
      WHERE id IN ('flags.multiCurrency', 'defaultCurrencyCode')`,
  );
  return toMultiCurrencyContext(new Map(rows.map(row => [row.id, row.value])));
}

/** The same, read synchronously (for spreadsheet code). */
export function getMultiCurrencyContextSync(): MultiCurrencyContext {
  const rows = db.runQuery<Pick<db.DbPreference, 'id' | 'value'>>(
    `SELECT id, value FROM preferences
      WHERE id IN ('flags.multiCurrency', 'defaultCurrencyCode')`,
    [],
    true,
  );
  return toMultiCurrencyContext(new Map(rows.map(row => [row.id, row.value])));
}

function toMultiCurrencyContext(
  prefs: Map<string, string | null | undefined>,
): MultiCurrencyContext {
  const budgetCurrency = prefs.get('defaultCurrencyCode') || '';
  const enabled =
    prefs.get('flags.multiCurrency') === 'true' && budgetCurrency !== '';
  return { enabled, budgetCurrency };
}

export async function getRateSettings(): Promise<RateSettings> {
  const [online, url] = await Promise.all([
    getPref(MC_PREF_RATES_ONLINE),
    getPref(MC_PREF_RATES_URL),
  ]);
  return { online: online !== 'false', url: url || DEFAULT_RATES_URL };
}

function clampToToday(date: string): string {
  const today = monthUtils.currentDay();
  return date > today ? today : date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Stores fetched or manual rates. A fetched rate never replaces a manual one
 * with the same id, and unchanged rows are skipped to avoid sync churn.
 * Writes happen outside undo so undoing a transaction edit keeps the rates.
 */
export async function storeRates(
  rates: FetchedRate[],
  source: RateSource,
): Promise<number> {
  const valid = rates.filter(
    rate =>
      isCurrencyCode(rate.base) &&
      isCurrencyCode(rate.quote) &&
      rate.base !== rate.quote &&
      rate.rate > 0,
  );
  if (valid.length === 0) {
    return 0;
  }

  const byId = new Map(
    valid.map(rate => [makeRateId(rate.date, rate.base, rate.quote), rate]),
  );
  const existing = new Map<
    string,
    Pick<db.DbMcExchangeRate, 'source' | 'rate' | 'tombstone'>
  >();
  for (const ids of chunk([...byId.keys()], SQL_CHUNK_SIZE)) {
    const rows = await db.all<
      Pick<db.DbMcExchangeRate, 'id' | 'source' | 'rate' | 'tombstone'>
    >(
      `SELECT id, source, rate, tombstone FROM mc_exchange_rates
        WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
    for (const row of rows) {
      existing.set(row.id, row);
    }
  }

  const toWrite = [...byId.entries()].filter(([id, rate]) => {
    const row = existing.get(id);
    if (!row || row.tombstone) {
      return true;
    }
    if (row.source === 'manual' && source !== 'manual') {
      return false;
    }
    return row.rate !== rate.rate || row.source !== source;
  });
  if (toWrite.length === 0) {
    return 0;
  }

  await withMutatorContext({ undoListening: false }, () =>
    batchMessages(async () => {
      for (const [id, rate] of toWrite) {
        await db.insertWithSchema('mc_exchange_rates', {
          id,
          date: rate.date,
          base: rate.base,
          quote: rate.quote,
          rate: rate.rate,
          source,
          tombstone: false,
        });
      }
    }),
  );
  return toWrite.length;
}

/**
 * The newest stored rate for the pair on or up to `carryForwardDays` before
 * `date`, in either direction. Manual rates win over fetched ones on the
 * same day.
 */
export async function getStoredRate(
  date: string,
  base: string,
  quote: string,
  carryForwardDays: number = RATE_CARRY_FORWARD_DAYS,
): Promise<RateLookup | null> {
  if (base === quote) {
    return { rate: 1, date, source: null };
  }
  const row = await db.first<db.DbMcExchangeRate>(
    `SELECT * FROM mc_exchange_rates
      WHERE tombstone = 0 AND rate > 0 AND date >= ? AND date <= ?
        AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
      ORDER BY date DESC, CASE WHEN source = 'manual' THEN 0 ELSE 1 END,
        CASE WHEN base = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    [
      db.toDateRepr(monthUtils.subDays(date, carryForwardDays)),
      db.toDateRepr(date),
      base,
      quote,
      quote,
      base,
      base,
    ],
  );
  if (!row) {
    return null;
  }
  return {
    rate: row.base === base ? row.rate : 1 / row.rate,
    date: db.fromDateRepr(row.date),
    source: row.source,
  };
}

const inflight = new Map<string, Promise<number>>();

/** Fetches and stores rates, sharing identical in-flight requests. */
async function fetchAndStore(
  url: string,
  query: Parameters<typeof fetchRates>[1],
): Promise<number> {
  const key = JSON.stringify([url, query]);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const request = fetchRates(url, query)
    .then(rates => storeRates(rates, 'frankfurter'))
    .catch(error => {
      logger.warn('[multi-currency] Could not fetch exchange rates:', error);
      return 0;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export async function getRate(
  date: string,
  base: string,
  quote: string,
  { allowFetch = true }: { allowFetch?: boolean } = {},
): Promise<RateLookup | null> {
  if (base === quote) {
    return { rate: 1, date, source: null };
  }
  const lookupDate = clampToToday(date);
  const stored = await getStoredRate(lookupDate, base, quote);
  if (stored || !allowFetch) {
    return stored;
  }
  const settings = await getRateSettings();
  if (!settings.online) {
    return null;
  }
  await fetchAndStore(settings.url, {
    base,
    quotes: [quote],
    date: lookupDate,
  });
  return getStoredRate(lookupDate, base, quote);
}

/**
 * Makes sure rates exist locally for every date, fetching one range for the
 * missing ones instead of one request per date. Used before bulk work such
 * as imports and backfills.
 */
export async function ensureRates(
  base: string,
  quote: string,
  dates: string[],
): Promise<void> {
  if (base === quote || dates.length === 0) {
    return;
  }
  const missing: string[] = [];
  for (const date of new Set(dates.map(clampToToday))) {
    if (!(await getStoredRate(date, base, quote))) {
      missing.push(date);
    }
  }
  if (missing.length === 0) {
    return;
  }
  const settings = await getRateSettings();
  if (!settings.online) {
    return;
  }
  missing.sort();
  await fetchAndStore(settings.url, {
    base,
    quotes: [quote],
    // Start a week early so weekend dates can carry forward Friday's rate
    from: monthUtils.subDays(missing[0], RATE_CARRY_FORWARD_DAYS),
    to: missing[missing.length - 1],
  });
}

/**
 * Downloads and stores every rate for a pair over a date range. An explicit
 * user action, so it works even with automatic fetching turned off and it
 * reports failures instead of hiding them.
 */
export async function fetchRange({
  base,
  quote,
  from,
  to,
}: {
  base: string;
  quote: string;
  from: string;
  to: string;
}): Promise<number> {
  if (!isCurrencyCode(base) || !isCurrencyCode(quote) || base === quote) {
    throw new Error(`Invalid currency pair: ${base}/${quote}`);
  }
  const { url } = await getRateSettings();
  const fetched = await fetchRates(url, {
    base,
    quotes: [quote],
    from,
    to: clampToToday(to),
  });
  return storeRates(fetched, 'frankfurter');
}

/** Converts minor units of `from` into minor units of `to`, or null. */
export async function convertAmount(
  amount: number,
  date: string,
  from: string,
  to: string,
  options?: { allowFetch?: boolean },
): Promise<number | null> {
  if (from === to) {
    return amount;
  }
  const lookup = await getRate(date, from, to, options);
  return lookup ? convertMinorUnits(amount, lookup.rate, from, to) : null;
}

function assertValidRateInput({
  date,
  base,
  quote,
  rate,
}: {
  date: string;
  base: string;
  quote: string;
  rate: number;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}`);
  }
  if (!isCurrencyCode(base) || !isCurrencyCode(quote) || base === quote) {
    throw new Error(`Invalid currency pair: ${base}/${quote}`);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid rate: ${rate}`);
  }
}

export async function setManualRate(input: {
  date: string;
  base: string;
  quote: string;
  rate: number;
}): Promise<string> {
  assertValidRateInput(input);
  const id = makeRateId(input.date, input.base, input.quote);
  await db.insertWithSchema('mc_exchange_rates', {
    id,
    date: input.date,
    base: input.base,
    quote: input.quote,
    rate: input.rate,
    source: 'manual',
    tombstone: false,
  });
  return id;
}

export async function deleteRate(id: string): Promise<void> {
  await db.delete_('mc_exchange_rates', id);
}

export async function listRates({
  currency,
  limit = 500,
}: { currency?: string; limit?: number } = {}): Promise<
  McExchangeRateEntity[]
> {
  const filter = currency ? 'AND (base = ? OR quote = ?)' : '';
  const params = currency ? [currency, currency, limit] : [limit];
  return db.selectWithSchema(
    'mc_exchange_rates',
    `SELECT * FROM mc_exchange_rates WHERE tombstone = 0 ${filter}
      ORDER BY date DESC, base, quote LIMIT ?`,
    params,
  );
}

/**
 * [fork:mc D-015] Rates for a series of dates, such as the ends of report
 * periods: 1 `base` = rate `quote`. Missing rates are fetched once as a
 * range; then each date takes the newest stored rate on or before it,
 * falling back to the oldest one after it. Future dates use today's rate.
 * Null only when the pair has no stored rate at all.
 */
export async function getRatesAt(
  base: string,
  quote: string,
  dates: string[],
): Promise<Record<string, number | null>> {
  if (base === quote) {
    return Object.fromEntries(dates.map(date => [date, 1]));
  }
  await ensureRates(base, quote, dates);

  const rows = await db.all<
    Pick<db.DbMcExchangeRate, 'date' | 'base' | 'rate' | 'source'>
  >(
    `SELECT date, base, rate, source FROM mc_exchange_rates
      WHERE tombstone = 0 AND rate > 0
        AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
      ORDER BY date,
        CASE WHEN source = 'manual' THEN 1 ELSE 0 END,
        CASE WHEN base = ? THEN 1 ELSE 0 END`,
    [base, quote, quote, base, base],
  );
  // One rate per day; the ordering puts the preferred row (manual, then
  // stored in this direction) last
  const byDay = new Map<number, number>();
  for (const row of rows) {
    byDay.set(row.date, row.base === base ? row.rate : 1 / row.rate);
  }
  const days = [...byDay.keys()];

  return Object.fromEntries(
    dates.map(date => {
      if (days.length === 0) {
        return [date, null];
      }
      const target = db.toDateRepr(clampToToday(date));
      // Newest day on or before the target (binary search)
      let low = 0;
      let high = days.length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (days[middle] <= target) {
          found = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      const day = days[found === -1 ? 0 : found];
      return [date, byDay.get(day) ?? null];
    }),
  );
}
