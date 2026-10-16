// [fork:mc D-017] An account's line in the default currency change: its
// transactions and why a currency is suggested for it.
import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import type { DefaultCurrencyAccount } from '@actual-app/core/server/multi-currency/default-currency';

type DefaultCurrencyAccountDetailsProps = {
  account: DefaultCurrencyAccount;
};

export function DefaultCurrencyAccountDetails({
  account,
}: DefaultCurrencyAccountDetailsProps) {
  const { suggested: code, notedTransactions: noted } = account;
  return (
    <Text style={{ color: theme.pageTextSubdued, fontSize: 12 }}>
      {account.transactions === 1 ? (
        <Trans>1 transaction</Trans>
      ) : (
        <Trans count={account.transactions}>
          {{ count: account.transactions }} transactions
        </Trans>
      )}
      {account.closed && (
        <>
          {' · '}
          <Trans>closed</Trans>
        </>
      )}
      {account.offbudget && (
        <>
          {' · '}
          <Trans>off budget</Trans>
        </>
      )}
      {account.reason === 'transaction-notes' && (
        <>
          {' · '}
          <Trans>
            {{ noted }} noted in {{ code }}
          </Trans>
        </>
      )}
      {account.reason === 'account-note' && (
        <>
          {' · '}
          <Trans>{{ code }} from the account note</Trans>
        </>
      )}
      {account.reason === 'account-name' && (
        <>
          {' · '}
          <Trans>{{ code }} from the account name</Trans>
        </>
      )}
    </Text>
  );
}
