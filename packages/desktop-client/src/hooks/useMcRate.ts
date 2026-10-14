// [fork:mc D-012] Looks up an exchange rate through the server: the budget's
// stored rates first, then the rate service when downloads are on.
import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';

export type McRateState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'found'; rate: number; date: string };

/** 1 `base` = `rate` `quote` on `date` (default: today). */
export function useMcRate(
  base: string,
  quote: string,
  date: string = monthUtils.currentDay(),
): McRateState {
  const [state, setState] = useState<McRateState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    setState({ status: 'loading' });
    if (!base || !quote) {
      setState({ status: 'missing' });
      return;
    }
    send('mc-get-rate', { date, base, quote })
      .then(lookup => {
        if (isCurrent) {
          setState(
            lookup
              ? { status: 'found', rate: lookup.rate, date: lookup.date }
              : { status: 'missing' },
          );
        }
      })
      .catch(() => {
        if (isCurrent) {
          setState({ status: 'missing' });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [base, quote, date]);

  return state;
}
