// [fork:mc D-013] Under the mobile editor's amount: the currency it is typed
// in when the transaction's account has its own currency.
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { getCurrency } from '@actual-app/core/shared/currencies';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useAccount } from '#hooks/useAccount';
import { useAccountCurrency } from '#hooks/useMultiCurrency';

type McAmountCurrencyHintProps = {
  accountId: AccountEntity['id'] | null | undefined;
};

export function McAmountCurrencyHint({ accountId }: McAmountCurrencyHintProps) {
  const account = useAccount(accountId ?? '');
  const { isForeign, currency } = useAccountCurrency(account);
  if (!isForeign) {
    return null;
  }

  return (
    <Text
      style={{ color: theme.pageTextSubdued, fontSize: 13 }}
      data-testid="mc-amount-currency"
    >
      {`${getCurrency(currency).name} (${currency})`}
    </Text>
  );
}
