// [fork:mc D-004] Client for the Frankfurter exchange-rate API (v2).
// https://frankfurter.dev — free, no key, CORS-enabled, self-hostable.
// The v2 `/rates` endpoint returns an array of `{ date, base, quote, rate }`,
// where 1 `base` = `rate` `quote`. Dates in the future return no rows.
import { fetch } from '#platform/server/fetch';

export type FetchedRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

type RatesQuery =
  | { base: string; quotes: string[]; date: string }
  | { base: string; quotes: string[]; from: string; to: string };

const REQUEST_TIMEOUT_MS = 15000;

function isFetchedRate(value: unknown): value is FetchedRate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.date === 'string' &&
    typeof record.base === 'string' &&
    typeof record.quote === 'string' &&
    typeof record.rate === 'number' &&
    Number.isFinite(record.rate) &&
    record.rate > 0
  );
}

export function buildRatesUrl(baseUrl: string, query: RatesQuery): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/rates`);
  url.searchParams.set('base', query.base);
  url.searchParams.set('quotes', query.quotes.join(','));
  if ('date' in query) {
    url.searchParams.set('date', query.date);
  } else {
    url.searchParams.set('from', query.from);
    url.searchParams.set('to', query.to);
  }
  return url.toString();
}

export function parseRatesResponse(json: unknown): FetchedRate[] {
  if (!Array.isArray(json)) {
    throw new Error('Unexpected exchange rate response');
  }
  return json
    .filter(isFetchedRate)
    .map(({ date, base, quote, rate }) => ({ date, base, quote, rate }));
}

export async function fetchRates(
  baseUrl: string,
  query: RatesQuery,
): Promise<FetchedRate[]> {
  const quotes = query.quotes.filter(quote => quote !== query.base);
  if (quotes.length === 0) {
    return [];
  }

  const response = await fetch(buildRatesUrl(baseUrl, { ...query, quotes }), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Exchange rate request failed (${response.status})`);
  }
  return parseRatesResponse(await response.json());
}
