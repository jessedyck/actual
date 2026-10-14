// [fork:mc D-007] Turns automatic exchange-rate downloads on or off.
import { useTranslation } from 'react-i18next';

import { Checkbox } from '#components/forms';
import { SettingsRow } from '#components/settings/SettingsRow';
import { useSyncedPref } from '#hooks/useSyncedPref';

export function RateDownloadSetting() {
  const { t } = useTranslation();
  const [ratesOnline, setRatesOnline] = useSyncedPref('mcRatesOnline');
  const isOnline = ratesOnline !== 'false';

  return (
    <SettingsRow
      htmlFor="settings-mc-rates-online"
      title={t('Download exchange rates')}
      description={t(
        'Fetch missing rates automatically from the exchange-rate service. Requests only contain currency codes and dates. When off, enter rates yourself below.',
      )}
      control={
        <Checkbox
          id="settings-mc-rates-online"
          checked={isOnline}
          onChange={() => setRatesOnline(isOnline ? 'false' : 'true')}
          style={{ marginRight: 0 }}
        />
      }
    />
  );
}
