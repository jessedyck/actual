// [fork:mc D-015] A report shown in another currency: a provider of this
// context around it makes `useFormat` format amounts in that currency.
import { createContext, useContext } from 'react';

export const McDisplayCurrencyContext = createContext<string | null>(null);

/** The currency the surrounding report is shown in, if not the budget's. */
export function useMcDisplayCurrencyOverride(): string | null {
  return useContext(McDisplayCurrencyContext);
}
