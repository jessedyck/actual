// [fork:mc D-002] A stored exchange rate: 1 `base` = `rate` `quote`.
export type McExchangeRateEntity = {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: number;
  source: 'frankfurter' | 'manual' | string | null;
  tombstone?: boolean;
};
