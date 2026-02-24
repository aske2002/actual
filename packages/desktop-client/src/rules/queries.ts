import { queryOptions } from '@tanstack/react-query';

import { send } from 'loot-core/platform/client/connection';
import type { PayeeEntity, RuleEntity } from 'loot-core/types/models';

export const ruleQueries = {
  all: () => ['rules'] as const,
  lists: () => [...ruleQueries.all(), 'lists'] as const,
  list: () =>
    queryOptions<RuleEntity[]>({
      queryKey: [...ruleQueries.lists()],
      queryFn: async () => {
        return await send('rules-get');
      },
      staleTime: Infinity,
    }),
  listPayee: ({ payeeId }: { payeeId?: PayeeEntity['id'] | null }) =>
    queryOptions<RuleEntity[]>({
      queryKey: [...ruleQueries.lists(), { payeeId }] as const,
      queryFn: async () => {
        if (!payeeId) {
          // Should never happen since the query is disabled when payeeId is not provided,
          // but is needed to satisfy TypeScript.
          throw new Error('payeeId is required.');
        }
        return await send('payees-get-rules', { id: payeeId });
      },
      staleTime: Infinity,
      enabled: !!payeeId,
    }),
};
