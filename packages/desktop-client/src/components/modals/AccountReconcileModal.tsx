import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
// [fork:mc D-008]
import {
  hundredthsToMinorUnits,
  minorUnitsToHundredths,
} from '@actual-app/core/shared/multi-currency';
import {
  amountToInteger,
  integerToAmount,
  tsToRelativeTime,
} from '@actual-app/core/shared/util';
import { format as formatDate } from 'date-fns';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { FieldLabel } from '#components/mobile/MobileForms';
import { AmountInput } from '#components/mobile/transactions/AmountInput';
import { useAccount } from '#hooks/useAccount';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
// [fork:mc D-008]
import { useMcAccountBalance } from '#hooks/useMcAccountBalance';
import { useAccountCurrency, useMultiCurrency } from '#hooks/useMultiCurrency';
import { useMultiCurrencyFormat } from '#hooks/useMultiCurrencyFormat';
import { useSheetValue } from '#hooks/useSheetValue';
import type { Modal as ModalType } from '#modals/modalsSlice';
import * as bindings from '#spreadsheet/bindings';

type AccountReconcileModalProps = Extract<
  ModalType,
  { name: 'account-reconcile' }
>['options'];

export function AccountReconcileModal({
  accountId,
  onReconcile,
}: AccountReconcileModalProps) {
  const { t } = useTranslation();
  const account = useAccount(accountId);
  const mobileCalculatorEnabled = useFeatureFlag('mobileCalculator');
  const clearedBalance = useSheetValue<'account', 'balanceCleared'>(
    bindings.accountBalanceCleared(accountId),
  );
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();

  // [fork:mc D-008] A foreign-currency account reconciles in its own
  // currency. The input counts hundredths like every amount input; the
  // amount handed on is in the currency's minor units.
  const accountCurrency = useAccountCurrency(account);
  const { isEnabled: isMultiCurrencyEnabled } = useMultiCurrency();
  const mcCleared = useMcAccountBalance(
    accountCurrency.isForeign ? accountId : null,
  )?.cleared;
  const mcFormat = useMultiCurrencyFormat();
  const startingAmount = !accountCurrency.isForeign
    ? clearedBalance
    : mcCleared == null
      ? null
      : minorUnitsToHundredths(mcCleared, accountCurrency.currency);

  const [amount, setAmount] = useState<number | null>(null);
  const [amountInputKey, setAmountInputKey] = useState(0);

  useEffect(() => {
    if (amount == null && startingAmount != null) {
      setAmount(startingAmount);
    }
  }, [amount, startingAmount]);

  const lastSyncedBalance = account?.balance_current;

  if (!account) {
    return null;
  }

  const onSubmit = (newAmount: number | null) => {
    if (newAmount == null) {
      return;
    }
    // [fork:mc D-008]
    onReconcile(
      accountCurrency.isForeign
        ? hundredthsToMinorUnits(newAmount, accountCurrency.currency)
        : newAmount,
    );
  };

  return (
    <Modal
      name="account-reconcile"
      wrapperProps={{
        style: mobileCalculatorEnabled ? { paddingBottom: '30vh' } : undefined,
      }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Reconcile')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View>
            <FieldLabel
              title={
                // [fork:mc D-008] Names the currency the balance is typed in
                isMultiCurrencyEnabled
                  ? t(
                      'Enter the current balance of your bank account, in {{currency}}, that you want to reconcile with:',
                      { currency: accountCurrency.currency },
                    )
                  : t(
                      'Enter the current balance of your bank account that you want to reconcile with:',
                    )
              }
            />
            {amount != null && (
              <View
                style={{
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <AmountInput
                  key={amountInputKey}
                  value={integerToAmount(amount)}
                  onChange={newAmount => setAmount(amountToInteger(newAmount))}
                  autoFocus
                  autoFocusDelay={150}
                  variant="large"
                />
              </View>
            )}
          </View>
          {lastSyncedBalance != null && (
            <View
              style={{
                alignItems: 'center',
                paddingTop: 10,
              }}
            >
              <Text>
                <Trans>Last Balance from Bank: </Trans>
                <FinancialText>
                  {/* [fork:mc D-008] The bank reports its own currency */}
                  {accountCurrency.isForeign
                    ? mcFormat.format(
                        hundredthsToMinorUnits(
                          lastSyncedBalance,
                          accountCurrency.currency,
                        ),
                        accountCurrency.currency,
                      )
                    : format(lastSyncedBalance, 'financial')}
                </FinancialText>
              </Text>
              <Button
                style={{
                  height: styles.mobileMinHeight,
                  marginTop: 5,
                  marginLeft: styles.mobileEditingPadding,
                  marginRight: styles.mobileEditingPadding,
                }}
                onPress={() => {
                  setAmount(lastSyncedBalance);
                  setAmountInputKey(key => key + 1);
                }}
              >
                <Trans>Use last synced total</Trans>
              </Button>
            </View>
          )}
          <View
            style={{
              justifyContent: 'center',
              alignItems: 'center',
              paddingTop: 10,
            }}
          >
            <Button
              variant="primary"
              isDisabled={amount == null}
              style={{
                height: styles.mobileMinHeight,
                marginLeft: styles.mobileEditingPadding,
                marginRight: styles.mobileEditingPadding,
              }}
              onPress={() => {
                onSubmit(amount);
                state.close();
              }}
            >
              <Trans>Reconcile</Trans>
            </Button>
          </View>
          <Text
            style={{
              color: theme.pageTextLight,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {account.last_reconciled
              ? t('Reconciled {{ relativeTimeAgo }} ({{ absoluteDate }})', {
                  relativeTimeAgo: tsToRelativeTime(
                    account.last_reconciled,
                    locale,
                  ),
                  absoluteDate: formatDate(
                    new Date(parseInt(account.last_reconciled, 10)),
                    dateFormat,
                    { locale },
                  ),
                })
              : t('Not yet reconciled')}
          </Text>
        </>
      )}
    </Modal>
  );
}
