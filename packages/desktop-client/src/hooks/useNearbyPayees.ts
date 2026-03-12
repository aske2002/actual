import { useQuery } from '@tanstack/react-query';

import { useLocationPermission } from './useLocationPermission';

import { payeeQueries } from '#payees';

export function useNearbyPayees() {
  const locationAccess = useLocationPermission();

  return useQuery({
    ...payeeQueries.listNearby(),
    enabled: !!locationAccess,
  });
}
