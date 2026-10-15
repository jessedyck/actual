// [fork:mc D-007] Converts transactions saved while no rate was available.
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { send } from '@actual-app/core/platform/client/connection';

import { SettingsRow } from '#components/settings/SettingsRow';
import { mcErrorMessage } from '#util/mcErrorMessage';

export function PendingConversionsSetting() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onConvert() {
    setIsLoading(true);
    try {
      const { updated, stillPending } = await send('mc-recompute-pending');
      setResult(
        [
          t('Filled in {{count}} transactions.', { count: updated }),
          stillPending > 0
            ? t('{{count}} still have no exchange rate.', {
                count: stillPending,
              })
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (error) {
      setResult(mcErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SettingsRow
      title={t('Budget values waiting for a rate')}
      description={
        <>
          <Trans>
            When no exchange rate can be downloaded (for example while offline),
            a transaction in another currency is saved with a budget value of 0
            until a rate is found. This fills those values in now.
          </Trans>
          {result && (
            <Text style={{ display: 'block', color: theme.noticeTextLight }}>
              {result}
            </Text>
          )}
        </>
      }
      control={
        <ButtonWithLoading isLoading={isLoading} onPress={onConvert}>
          <Trans>Fill in now</Trans>
        </ButtonWithLoading>
      }
    />
  );
}
