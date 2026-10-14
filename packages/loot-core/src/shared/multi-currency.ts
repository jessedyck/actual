// [fork:mc D-003] Fork-only multi-currency helpers shared by the client and
// the server. See fork/DEVIATIONS.md.
//
// Model: `transactions.amount` is always in the budget currency (so budgets,
// balances and reports keep working unchanged). Accounts in another currency
// also store `mc_amount`, the amount in the account's own currency expressed
// in that currency's minor units (e.g. yen for JPY, fils for KWD).
import { getDecimalPlaces } from './currencies';

type AccountCurrencyFields = { mc_currency?: string | null };

/** How many days back a stored rate may be reused for a later date. */
export const RATE_CARRY_FORWARD_DAYS = 7;

/** Default public Frankfurter API (v2). Self-hosting is supported. */
export const DEFAULT_RATES_URL = 'https://api.frankfurter.dev/v2';

/** Synced preference keys owned by the fork. */
export const MC_PREF_RATES_ONLINE = 'mcRatesOnline';
export const MC_PREF_RATES_URL = 'mcRatesUrl';

/** The account's currency, falling back to the budget currency. */
export function getAccountCurrency(
  account: AccountCurrencyFields | null | undefined,
  budgetCurrency: string,
): string {
  return account?.mc_currency || budgetCurrency;
}

/**
 * True when the account has its own currency that differs from the budget
 * currency. Always false while no budget currency is set, because the whole
 * feature depends on knowing what the budget currency is.
 */
export function isForeignCurrencyAccount(
  account: AccountCurrencyFields | null | undefined,
  budgetCurrency: string | null | undefined,
): boolean {
  const code = account?.mc_currency;
  return Boolean(code && budgetCurrency && code !== budgetCurrency);
}

/**
 * Rounds half away from zero, after trimming floating point noise, so that
 * converting `x` and `-x` always gives mirrored results (transfers rely on it).
 */
export function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.round(Number(Math.abs(value).toFixed(6)));
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/**
 * Converts an integer amount in `from`'s minor units to `to`'s minor units,
 * where 1 unit of `from` = `rate` units of `to`.
 */
export function convertMinorUnits(
  amount: number,
  rate: number,
  from: string,
  to: string,
): number {
  const fromScale = 10 ** getDecimalPlaces(from);
  const toScale = 10 ** getDecimalPlaces(to);
  return roundHalfAwayFromZero((amount / fromScale) * rate * toScale);
}

/**
 * The rate a transaction was recorded at: 1 unit of the account currency =
 * the returned number of budget-currency units. Null when there is no
 * account-currency amount to divide by.
 */
export function getImpliedRate(
  amount: number,
  mcAmount: number | null | undefined,
  accountCurrency: string,
  budgetCurrency: string,
): number | null {
  if (!mcAmount) {
    return null;
  }
  const budgetValue = amount / 10 ** getDecimalPlaces(budgetCurrency);
  const accountValue = mcAmount / 10 ** getDecimalPlaces(accountCurrency);
  return budgetValue / accountValue;
}

/** Deterministic id for a stored rate, e.g. `20261013:CAD:EUR`. */
export function makeRateId(date: string, base: string, quote: string): string {
  return `${date.replaceAll('-', '')}:${base}:${quote}`;
}

/** True for a three-letter uppercase ISO 4217-style code. */
export function isCurrencyCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}
