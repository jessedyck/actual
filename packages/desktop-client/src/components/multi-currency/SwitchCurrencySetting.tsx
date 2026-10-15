// [fork:mc D-016] Settings → Multi-currency accounts → Change budget
// currency: moves the budget and its history to another currency.
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';

import { SettingsRow } from '#components/settings/SettingsRow';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

export function SwitchCurrencySetting() {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  return (
    <SettingsRow
      title={t('Change budget currency')}
      description={
        <Trans>
          Moves the whole budget to another currency, history included. Each
          transaction is converted at its own date's exchange rate and each
          month's budget at that month's average rate. Accounts can keep their
          own currency.
        </Trans>
      }
      control={
        <Button
          onPress={() =>
            dispatch(pushModal({ modal: { name: 'mc-switch-currency' } }))
          }
        >
          <Trans>Change budget currency</Trans>
        </Button>
      }
    />
  );
}
