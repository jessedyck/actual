// [fork:mc D-005] Server handlers for the fork's multi-currency feature.
import { createApp } from '#server/app';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';

import { recomputePending, setAccountCurrency } from './accounts';
import * as rates from './rates';

export type MultiCurrencyHandlers = {
  'mc-get-context': typeof getContext;
  'mc-get-rate': typeof getRate;
  'mc-convert': typeof convert;
  'mc-rates-list': typeof rates.listRates;
  'mc-rate-set': typeof rates.setManualRate;
  'mc-rate-delete': typeof deleteRate;
  'mc-rates-fetch': typeof rates.fetchRange;
  'mc-account-set-currency': typeof setAccountCurrency;
  'mc-recompute-pending': typeof recomputePending;
  'mc-rates-at': typeof getRatesAt;
};

export const app = createApp<MultiCurrencyHandlers>();

// Lookups can download and store rates, so they run as mutators (outside
// undo; see `storeRates`)
app.method('mc-get-context', getContext);
app.method('mc-get-rate', mutator(getRate));
app.method('mc-convert', mutator(convert));
app.method('mc-rates-list', rates.listRates);
app.method('mc-rate-set', mutator(undoable(rates.setManualRate)));
app.method('mc-rate-delete', mutator(undoable(deleteRate)));
app.method('mc-rates-fetch', mutator(rates.fetchRange));
app.method('mc-account-set-currency', mutator(undoable(setAccountCurrency)));
app.method('mc-recompute-pending', mutator(undoable(recomputePending)));
// [fork:mc D-015] Report valuation
app.method('mc-rates-at', mutator(getRatesAt));

async function getContext(): Promise<
  rates.MultiCurrencyContext & rates.RateSettings
> {
  const [context, settings] = await Promise.all([
    rates.getMultiCurrencyContext(),
    rates.getRateSettings(),
  ]);
  return { ...context, ...settings };
}

async function getRate({
  date,
  base,
  quote,
  allowFetch = true,
}: {
  date: string;
  base: string;
  quote: string;
  allowFetch?: boolean;
}): Promise<rates.RateLookup | null> {
  return rates.getRate(date, base, quote, { allowFetch });
}

async function convert({
  amount,
  date,
  from,
  to,
}: {
  amount: number;
  date: string;
  from: string;
  to: string;
}): Promise<number | null> {
  return rates.convertAmount(amount, date, from, to);
}

async function deleteRate({ id }: { id: string }): Promise<void> {
  await rates.deleteRate(id);
}

async function getRatesAt({
  base,
  quote,
  dates,
}: {
  base: string;
  quote: string;
  dates: string[];
}): Promise<Record<string, number | null>> {
  return rates.getRatesAt(base, quote, dates);
}
