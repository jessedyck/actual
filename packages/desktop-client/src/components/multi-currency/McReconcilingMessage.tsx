// [fork:mc D-008] Upstream's `ReconcilingMessage` for a foreign-currency
// account: the cleared balance, the statement balance and the difference are
// in the account's currency.
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgCheckCircle1 } from '@actual-app/components/icons/v2';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { TransObjectLiteral } from '@actual-app/core/types/util';

import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';

type McReconcilingMessageProps = {
  accountId: string;
  currency: string;
  targetBalance: number;
  onDone: () => void;
  onCreateTransaction: (targetDiff: number) => void;
};

export function McReconcilingMessage({
  accountId,
  currency,
  targetBalance,
  onDone,
  onCreateTransaction,
}: McReconcilingMessageProps) {
  const { t } = useTranslation();
  const mcFormat = useMultiCurrencyFormat();
  const cleared = useMcAccountBalance(accountId)?.cleared ?? 0;
  const targetDiff = targetBalance - cleared;

  const clearedBalance = mcFormat.format(cleared, currency);
  const bankBalance = mcFormat.format(targetBalance, currency);
  const difference = mcFormat.format(targetDiff, currency, {
    withSign: targetDiff > 0,
  });

  return (
    <View
      style={{
        flexDirection: 'row',
        alignSelf: 'center',
        backgroundColor: theme.tableBackground,
        ...styles.shadow,
        borderRadius: 4,
        marginTop: 5,
        marginBottom: 15,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {targetDiff === 0 ? (
          <View
            style={{
              color: theme.noticeTextLight,
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SvgCheckCircle1
              style={{
                width: 13,
                height: 13,
                color: 'inherit',
                marginRight: 3,
              }}
            />
            <Trans>All reconciled!</Trans>
          </View>
        ) : (
          <View style={{ color: theme.tableText }}>
            <Text style={{ fontStyle: 'italic', textAlign: 'center' }}>
              <Trans>
                Your cleared balance{' '}
                <strong>{{ clearedBalance } as TransObjectLiteral}</strong>{' '}
                needs <strong>{{ difference } as TransObjectLiteral}</strong> to
                match
                <br /> your bank&apos;s balance of{' '}
                <Text style={{ fontWeight: 700 }}>
                  {{ bankBalance } as TransObjectLiteral}
                </Text>
              </Trans>
            </Text>
          </View>
        )}
        <View style={{ marginLeft: 15 }}>
          <Button variant="primary" onPress={onDone}>
            {targetDiff === 0
              ? t('Lock transactions')
              : t('Exit reconciliation')}
          </Button>
        </View>
        {targetDiff !== 0 && (
          <View style={{ marginLeft: 15 }}>
            <Button onPress={() => onCreateTransaction(targetDiff)}>
              <Trans>Create reconciliation transaction</Trans>
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}
