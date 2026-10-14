// [fork:mc D-007] Address of the Frankfurter-compatible rate service.
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { DEFAULT_RATES_URL } from '@actual-app/core/shared/multi-currency';

import { SettingsRow } from '#components/settings/SettingsRow';
import { useSyncedPref } from '#hooks/useSyncedPref';

export function RateServiceSetting() {
  const { t } = useTranslation();
  const [ratesUrl, setRatesUrl] = useSyncedPref('mcRatesUrl');
  const [error, setError] = useState<string | null>(null);

  function onUpdate(value: string) {
    const url = value.trim();
    if (url !== '' && !/^https?:\/\/\S+$/.test(url)) {
      setError(t('Enter a web address starting with http:// or https://'));
      return;
    }
    setError(null);
    if (url !== (ratesUrl ?? '')) {
      setRatesUrl(url);
    }
  }

  return (
    <SettingsRow
      htmlFor="settings-mc-rates-url"
      title={t('Exchange-rate service')}
      description={
        <>
          <Trans>
            A Frankfurter-compatible API (v2). Leave empty to use the public
            one. Frankfurter can also be self-hosted.
          </Trans>
          {error && (
            <Text style={{ display: 'block', color: theme.errorText }}>
              {error}
            </Text>
          )}
        </>
      }
      control={
        <Input
          id="settings-mc-rates-url"
          defaultValue={ratesUrl ?? ''}
          placeholder={DEFAULT_RATES_URL}
          onUpdate={onUpdate}
          style={{ width: 280, maxWidth: '100%' }}
        />
      }
    />
  );
}
