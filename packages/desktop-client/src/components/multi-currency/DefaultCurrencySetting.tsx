// [fork:mc D-017] Settings → Multi-currency accounts → Default currency:
// changes the default currency without changing past budgets.
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';

import { SettingsRow } from '#components/settings/SettingsRow';
import { useMultiCurrency } from '#hooks/useMultiCurrency';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

export function DefaultCurrencySetting() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { budgetCurrency } = useMultiCurrency();

  return (
    <SettingsRow
      title={t('Default currency')}
      description={
        <Trans>
          Budgets and accounts without a currency of their own use the default
          currency, {{ budgetCurrency }}, as does To Budget. Changing it here
          can keep past budgets in {{ budgetCurrency }}, so they show what they
          showed before.
        </Trans>
      }
      control={
        <Button
          onPress={() =>
            dispatch(pushModal({ modal: { name: 'mc-default-currency' } }))
          }
        >
          <Trans>Change default currency</Trans>
        </Button>
      }
    />
  );
}
