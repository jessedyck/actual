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

// [fork:mc D-013] Register view in the account's currency.
//
// The register (and its split, balance and input logic) only knows `amount`.
// For a foreign-currency account the fork swaps the two amounts while the
// register shows it: `amount` holds the account-currency value and the real
// budget amount waits in `_mcBudgetAmount`. Field names starting with `_` are
// ignored by the server, so a leaked view field can't be stored.

/**
 * The register, file imports and the API count amounts in hundredths, whatever
 * the currency, while `mc_amount` uses the currency's own minor units (whole
 * yen for JPY). These two convert between them; for currencies with two
 * decimals they change nothing.
 */
export function minorUnitsToHundredths(
  amount: number,
  currency: string,
): number {
  return roundHalfAwayFromZero(amount * 10 ** (2 - getDecimalPlaces(currency)));
}

export function hundredthsToMinorUnits(
  amount: number,
  currency: string,
): number {
  return roundHalfAwayFromZero(amount / 10 ** (2 - getDecimalPlaces(currency)));
}

type ViewableTransaction = {
  amount: number;
  mc_amount?: number | null;
  subtransactions?: ViewableTransaction[];
};

/** Extra fields a transaction carries while shown in its account currency. */
export type AccountCurrencyViewFields = {
  _mcView?: true;
  /** The real `amount`, in the budget currency */
  _mcBudgetAmount?: number;
  /** Set when no account amount was stored: the estimate shown instead */
  _mcEstimate?: number | null;
};

export type AccountCurrencyViewOptions = {
  /** The account's currency */
  currency: string;
  /** Account amount (in its minor units) for a budget amount, or null */
  estimate?: (budgetAmount: number) => number | null;
};

/**
 * The transaction as the register shows it in its account's currency.
 * Transactions without a stored account amount (schedule previews, pending
 * conversions) show the estimate, or 0 when there is none.
 */
export function toAccountCurrencyView<T extends ViewableTransaction>(
  transaction: T,
  options: AccountCurrencyViewOptions,
): T & AccountCurrencyViewFields {
  const view = transaction as T & AccountCurrencyViewFields;
  if (view._mcView) {
    return view;
  }
  const { currency, estimate = () => null } = options;
  const stored = transaction.mc_amount;
  const estimated = stored == null ? estimate(transaction.amount) : null;
  const estimatedView =
    estimated == null ? null : minorUnitsToHundredths(estimated, currency);
  return {
    ...transaction,
    amount:
      stored != null
        ? minorUnitsToHundredths(stored, currency)
        : (estimatedView ?? 0),
    _mcView: true,
    _mcBudgetAmount: transaction.amount,
    ...(stored == null ? { _mcEstimate: estimatedView } : {}),
    ...(transaction.subtransactions
      ? {
          subtransactions: transaction.subtransactions.map(sub =>
            toAccountCurrencyView(sub, options),
          ),
        }
      : {}),
  };
}

/** Undoes `toAccountCurrencyView`, keeping any edit of the shown amount. */
export function fromAccountCurrencyView<T extends ViewableTransaction>(
  transaction: T & AccountCurrencyViewFields,
  currency: string,
): T {
  if (!transaction._mcView) {
    return transaction;
  }
  const { _mcView, _mcBudgetAmount, _mcEstimate, ...rest } = transaction;
  const isUntouchedEstimate =
    _mcEstimate !== undefined && rest.amount === (_mcEstimate ?? 0);
  return {
    ...rest,
    amount: _mcBudgetAmount ?? 0,
    mc_amount: isUntouchedEstimate
      ? (rest.mc_amount ?? null)
      : hundredthsToMinorUnits(rest.amount, currency),
    ...(rest.subtransactions
      ? {
          subtransactions: rest.subtransactions.map(sub =>
            fromAccountCurrencyView(sub, currency),
          ),
        }
      : {}),
  } as unknown as T;
}

type ViewDiffItem = Partial<ViewableTransaction> &
  AccountCurrencyViewFields & { [key: string]: unknown };

/**
 * Converts a register diff made in the account-currency view into fields
 * the server understands: an edited `amount` is the account amount, and the
 * budget amount is left for the server to derive (D-006).
 */
export function diffFromAccountCurrencyView<
  D extends { added?: ViewDiffItem[]; updated?: ViewDiffItem[] },
>(diff: D, currency: string): D {
  const strip = ({
    _mcView,
    _mcBudgetAmount,
    _mcEstimate,
    ...rest
  }: ViewDiffItem) => rest;

  return {
    ...diff,
    added: diff.added?.map(item => {
      const isUntouchedEstimate =
        item._mcEstimate !== undefined &&
        (item.amount ?? 0) === (item._mcEstimate ?? 0);
      const { amount, ...rest } = strip(item);
      return isUntouchedEstimate
        ? { ...rest, amount: item._mcBudgetAmount ?? 0 }
        : {
            ...rest,
            mc_amount: hundredthsToMinorUnits(amount ?? 0, currency),
            amount: item._mcBudgetAmount ?? 0,
          };
    }),
    updated: diff.updated?.map(item => {
      const { amount, ...rest } = strip(item);
      return {
        ...rest,
        ...(amount !== undefined
          ? { mc_amount: hundredthsToMinorUnits(amount, currency) }
          : {}),
        ...(item._mcBudgetAmount !== undefined
          ? { amount: item._mcBudgetAmount }
          : {}),
      };
    }),
  };
}

/** Server-side updates (real fields) mapped onto the account-currency view. */
export function updatesToAccountCurrencyView<T extends ViewDiffItem>(
  updates: T[],
  currency: string,
): T[] {
  return updates.map(({ amount, mc_amount, ...rest }) => ({
    ...rest,
    ...(mc_amount != null
      ? { amount: minorUnitsToHundredths(mc_amount, currency), mc_amount }
      : {}),
    ...(amount !== undefined ? { _mcBudgetAmount: amount } : {}),
  })) as T[];
}
