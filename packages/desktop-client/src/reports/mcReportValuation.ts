// [fork:mc D-015] Values report balances in a display currency.
//
// Net worth: a foreign-currency account's balance is summed in its own
// currency (`mc_amount`) and valued at the rate of each period's end, so the
// report follows what the account is worth instead of the rates its
// transactions were recorded at. Every balance is then converted into the
// display currency, through the budget currency, at the same date.
import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { convertMinorUnits } from '@actual-app/core/shared/multi-currency';

export type McValuationConfig = {
  budgetCurrency: string;
  /** The currency reports are shown in */
  displayCurrency: string;
  /** The account's own currency when it differs from the budget's, or null */
  foreignCurrencyOf: (accountId: string) => string | null;
};

export type McNetWorthValuation = {
  /** AQL field the account's balances are summed from */
  sumField: (accountId: string) => '$amount' | '$mc_amount';
  /** A transfer leg in the units its account is summed in */
  legInSumUnits: <
    T extends { account: string; amount: number; mc_amount?: number | null },
  >(
    leg: T,
  ) => T;
  /** A balance at the end of the interval `intervalKey`, valued */
  value: (accountId: string, intervalKey: string, balance: number) => number;
  /** The balance before the first interval, valued */
  valueStarting: (accountId: string, balance: number) => number;
};

type Rates = Record<string, number | null>;

/** Interval keys as the net worth report builds them. */
export function getIntervalKeys(
  startDate: string,
  endDate: string,
  interval: string,
  firstDayOfWeekIdx: string,
): string[] {
  return interval === 'Weekly'
    ? monthUtils.weekRangeInclusive(startDate, endDate, firstDayOfWeekIdx)
    : interval === 'Daily'
      ? monthUtils.dayRangeInclusive(startDate, endDate)
      : interval === 'Yearly'
        ? monthUtils.yearRangeInclusive(startDate, endDate)
        : monthUtils.rangeInclusive(
            monthUtils.getMonth(startDate),
            monthUtils.getMonth(endDate),
          );
}

/** The last day of an interval key. */
export function getIntervalEndDate(key: string, interval: string): string {
  switch (interval) {
    case 'Daily':
      return key;
    case 'Weekly':
      return monthUtils.addDays(key, 6);
    case 'Yearly':
      return `${key}-12-31`;
    default:
      return monthUtils.lastDayOfMonth(key);
  }
}

async function fetchRates(
  base: string,
  quote: string,
  dates: string[],
): Promise<Rates | null> {
  if (base === quote) {
    return null;
  }
  const rates = await send('mc-rates-at', { base, quote, dates });
  return Object.values(rates).some(rate => rate != null) ? rates : null;
}

/**
 * Null when nothing needs valuing: no foreign-currency accounts and the
 * display currency is the budget currency.
 */
export async function prepareNetWorthValuation(
  { budgetCurrency, displayCurrency, foreignCurrencyOf }: McValuationConfig,
  {
    accountIds,
    startDate,
    endDate,
    interval,
    firstDayOfWeekIdx,
  }: {
    accountIds: string[];
    startDate: string;
    endDate: string;
    interval: string;
    firstDayOfWeekIdx: string;
  },
): Promise<McNetWorthValuation | null> {
  const foreignCurrencies = new Set(
    accountIds
      .map(foreignCurrencyOf)
      .filter((code): code is string => code !== null),
  );
  if (foreignCurrencies.size === 0 && displayCurrency === budgetCurrency) {
    return null;
  }

  const keys = getIntervalKeys(startDate, endDate, interval, firstDayOfWeekIdx);
  const startingDate = monthUtils.subDays(startDate, 1);
  const dates = [
    startingDate,
    ...keys.map(key => getIntervalEndDate(key, interval)),
  ];

  // Accounts in a currency without any rate keep their recorded budget
  // amounts
  const toBudget = new Map<string, Rates>();
  for (const currency of foreignCurrencies) {
    const rates = await fetchRates(currency, budgetCurrency, dates);
    if (rates) {
      toBudget.set(currency, rates);
    }
  }
  const toDisplay = await fetchRates(budgetCurrency, displayCurrency, dates);

  const valuedCurrency = (accountId: string) => {
    const currency = foreignCurrencyOf(accountId);
    return currency !== null && toBudget.has(currency) ? currency : null;
  };

  const valueAt = (accountId: string, date: string, balance: number) => {
    const currency = valuedCurrency(accountId);
    let value = balance;
    if (currency !== null) {
      const rate = toBudget.get(currency)?.[date];
      value =
        rate == null
          ? 0
          : convertMinorUnits(balance, rate, currency, budgetCurrency);
    }
    const displayRate = toDisplay?.[date];
    return displayRate == null
      ? value
      : convertMinorUnits(value, displayRate, budgetCurrency, displayCurrency);
  };

  return {
    sumField: accountId =>
      valuedCurrency(accountId) !== null ? '$mc_amount' : '$amount',
    legInSumUnits: leg =>
      valuedCurrency(leg.account) !== null
        ? { ...leg, amount: leg.mc_amount ?? 0 }
        : leg,
    value: (accountId, key, balance) =>
      valueAt(accountId, getIntervalEndDate(key, interval), balance),
    valueStarting: (accountId, balance) =>
      valueAt(accountId, startingDate, balance),
  };
}
