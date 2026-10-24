// [fork:mc D-005] Server handlers for the fork's multi-currency feature.
import { logger } from '#platform/server/log';
import { createApp } from '#server/app';
import { mutator, runMutator } from '#server/mutators';
import { addSyncListener } from '#server/sync';
import { undoable } from '#server/undo';
import { MC_PREF_MONTH_RATES } from '#shared/multi-currency';

import {
  getAccountTotals,
  recomputePending,
  setAccountCurrency,
  syncAccountCurrencyNotes,
} from './accounts';
import { setBudgetCurrency } from './budget-currency';
import {
  migrateCurrencyPeriods,
  previewDefaultCurrency,
  setDefaultCurrency,
} from './default-currency';
import {
  applyBudgetFactors,
  createMonthRateLookup,
  getMonthRates,
  refreshMonthRates,
  setMonthRate,
} from './month-rates';
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
  'mc-default-currency-preview': typeof previewDefaultCurrency;
  'mc-default-currency-set': typeof setDefaultCurrency;
  'mc-budget-set-currency': typeof setBudgetCurrency;
  'mc-month-rates': typeof getMonthRates;
  'mc-month-rate-set': typeof setMonthRate;
  'mc-month-rates-refresh': typeof refreshMonthRates;
  'mc-month-convert': typeof convertAtMonth;
  'mc-account-totals': typeof getAccountTotals;
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
// [fork:mc D-017] Default currency, budget currencies and month rates
app.method('mc-default-currency-preview', mutator(previewDefaultCurrency));
app.method('mc-default-currency-set', mutator(undoable(setDefaultCurrency)));
app.method('mc-budget-set-currency', mutator(undoable(setBudgetCurrency)));
app.method('mc-month-rates', mutator(getMonthRates));
app.method('mc-month-rate-set', mutator(undoable(setMonthRate)));
app.method('mc-month-rates-refresh', mutator(refreshMonthRates));
app.method('mc-month-convert', mutator(convertAtMonth));
// [fork:mc D-012] Account totals in another currency
app.method('mc-account-totals', mutator(getAccountTotals));

/**
 * [fork:mc D-017] While a budget file is open: keeps the budget's
 * conversion cells in step with currency and rate changes (including undo
 * and changes synced from other devices). Once, when it opens: moves
 * budget currencies an earlier version stored by date onto the budgets,
 * and brings this month's rates up to date.
 */
type ChangedRows = Map<string, Record<string, unknown>>;

app.service(() => {
  const unlisten = addSyncListener((oldValues, newValues) => {
    const rowsOf = (data: Map<string, unknown>, table: string) =>
      data.get(table) as ChangedRows | undefined;
    const changedPrefs = [
      ...(rowsOf(newValues, 'preferences')?.keys() ?? []),
    ].some(id => [MC_PREF_MONTH_RATES, 'defaultCurrencyCode'].includes(id));
    const changedBudgets = ['zero_budgets', 'reflect_budgets'].some(table =>
      [...(rowsOf(newValues, table)?.entries() ?? [])].some(
        ([id, row]) =>
          'mc_currency' in row &&
          rowsOf(oldValues, table)?.get(id)?.mc_currency !== row.mc_currency,
      ),
    );
    if (changedPrefs || changedBudgets || newValues.has('categories')) {
      applyBudgetFactors();
    }
  });
  void runMutator(async () => {
    await migrateCurrencyPeriods();
    // [fork:mc D-012] Accounts' currencies in their notes
    await syncAccountCurrencyNotes();
    await refreshMonthRates();
  }).catch(error => {
    logger.warn('[multi-currency] Could not refresh month rates:', error);
  });
  return unlisten;
});

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

/** [fork:mc D-017] Minor units of `from` in `to` at a month's rate. */
async function convertAtMonth({
  amount,
  month,
  from,
  to,
}: {
  amount: number;
  month: string;
  from: string;
  to: string;
}): Promise<number | null> {
  const lookup = createMonthRateLookup();
  const converted = await lookup.convert(amount, month, from, to);
  await lookup.flush();
  return converted;
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
