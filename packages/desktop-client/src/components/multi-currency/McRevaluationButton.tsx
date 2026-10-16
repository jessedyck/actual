// [fork:mc D-014] Next to a foreign-currency account's balances: records the
// difference between what the account is worth today and its value in the
// budget, as a transaction that changes only the budget-currency amount.
import { useEffect, useState } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Popover } from '@actual-app/components/popover';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';
import type { TransObjectLiteral } from '@actual-app/core/types/util';

import {
  countPendingConversions,
  createRevaluationTransaction,
} from '#accounts/mcRevaluation';
import { useFormat } from '#hooks/useFormat';

type McRevaluationButtonProps = {
  account: AccountEntity;
  currency: string;
  /** Today's value of the account's balance, in the budget currency */
  worthToday: number | null;
  /** The budget-currency total of its transactions */
  budgetValue: number;
};

export function McRevaluationButton({
  account,
  currency,
  worthToday,
  budgetValue,
}: McRevaluationButtonProps) {
  const format = useFormat();
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let isCurrent = true;
    void countPendingConversions(account.id).then(count => {
      if (isCurrent) {
        setPending(count);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [isOpen, account.id]);

  if (worthToday === null || worthToday === budgetValue) {
    return null;
  }
  const difference = worthToday - budgetValue;
  const formattedDifference = format(difference, 'financial-with-sign');

  async function onRecord() {
    setIsSaving(true);
    try {
      await createRevaluationTransaction(account.id, difference);
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="bare"
        style={{ color: theme.pageTextLink, padding: '4px 6px' }}
      >
        <Trans>Adjust to today's value…</Trans>
      </Button>
      <Popover style={{ width: 320 }}>
        <Dialog>
          <View style={{ padding: 12, gap: 10 }}>
            <Text>
              <Trans>
                Record{' '}
                <strong>{{ formattedDifference } as TransObjectLiteral}</strong>{' '}
                so this account counts at what it is worth today. Its{' '}
                {{ currency }} balance doesn't change.
              </Trans>
            </Text>
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>
                The transaction is dated today, with the note "Exchange rate
                adjustment". Categorize it like any other, or let a rule do it.
              </Trans>
            </Text>
            {pending !== null && pending > 0 && (
              <Text style={{ color: theme.warningText }}>
                <Trans count={pending}>
                  {{ count: pending }} transactions are still waiting for an
                  exchange rate. Fill in their budget values first in Settings.
                </Trans>
              </Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                isDisabled={isSaving || pending === null || pending > 0}
                onPress={onRecord}
              >
                <Trans>Record adjustment</Trans>
              </Button>
            </View>
          </View>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
