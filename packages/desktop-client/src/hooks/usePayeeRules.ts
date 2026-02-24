import { useQuery } from '@tanstack/react-query';

import type { PayeeEntity } from 'loot-core/types/models';

import { ruleQueries } from '@desktop-client/rules/queries';

export function usePayeeRules({
  payeeId,
}: {
  payeeId?: PayeeEntity['id'] | null;
}) {
  return useQuery(ruleQueries.listPayee({ payeeId }));
}
