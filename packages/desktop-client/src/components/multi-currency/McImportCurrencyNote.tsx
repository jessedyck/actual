// [fork:mc D-008] In the import modal of a foreign-currency account, says
// which currency the file's amounts are read in.
import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { getCurrency } from '@actual-app/core/shared/currencies';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useAccount } from '#hooks/useAccount';
import { useAccountCurrency } from '#hooks/useMultiCurrency';

type McImportCurrencyNoteProps = {
  accountId: AccountEntity['id'];
};

export function McImportCurrencyNote({ accountId }: McImportCurrencyNoteProps) {
  const account = useAccount(accountId);
  const { isForeign, currency } = useAccountCurrency(account);
  if (!isForeign) {
    return null;
  }
  const currencyName = getCurrency(currency).name;

  return (
    <Text style={{ color: theme.pageTextLight }}>
      <Trans>
        Amounts are read in {{ currencyName }} ({{ currency }}).
      </Trans>
    </Text>
  );
}
