// [fork:mc D-015] Wraps a report (page or dashboard card) that can be shown
// in another currency: amounts inside are formatted in that currency, and
// the report reads the valuation settings from the context.
import type { ReactNode } from 'react';

import { McDisplayCurrencyContext } from '#hooks/useMcDisplayCurrency';
import {
  McReportCurrencyContext,
  useMcReportCurrency,
} from '#hooks/useMcReportCurrency';

export function McReportCurrencyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const reportCurrency = useMcReportCurrency();
  const override =
    reportCurrency.effectiveCurrency !== reportCurrency.budgetCurrency
      ? reportCurrency.effectiveCurrency
      : null;

  return (
    <McReportCurrencyContext.Provider value={reportCurrency}>
      <McDisplayCurrencyContext.Provider value={override}>
        {children}
      </McDisplayCurrencyContext.Provider>
    </McReportCurrencyContext.Provider>
  );
}
