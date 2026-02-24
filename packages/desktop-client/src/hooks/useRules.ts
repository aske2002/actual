import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';

import type { RuleEntity } from 'loot-core/types/models';

import { ruleQueries } from '@desktop-client/rules/queries';

type UseRulesOptions = Pick<UseQueryOptions<RuleEntity[]>, 'enabled'>;

export function useRules(options?: UseRulesOptions) {
  return useQuery({
    ...ruleQueries.list(),
    ...(options ?? {}),
  });
}
