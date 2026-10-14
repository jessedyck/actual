// [fork:mc D-012] Same look as upstream's `DetailedBalance` pill in the
// account header (which isn't exported).

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';

type McBalancePillProps = {
  name: string;
  value: string;
  title?: string;
};

export function McBalancePill({ name, value, title }: McBalancePillProps) {
  return (
    <Text
      title={title}
      style={{
        borderRadius: 4,
        padding: '4px 6px',
        color: theme.pillText,
        backgroundColor: theme.pillBackground,
      }}
    >
      {name}{' '}
      <PrivacyFilter>
        <FinancialText style={{ fontWeight: 600 }}>{value}</FinancialText>
      </PrivacyFilter>
    </Text>
  );
}
