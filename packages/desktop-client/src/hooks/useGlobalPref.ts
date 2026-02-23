import { useQuery } from '@tanstack/react-query';

import type { GlobalPrefs } from 'loot-core/types/prefs';

import { prefQueries, useSaveGlobalPrefsMutation } from '@desktop-client/prefs';

type SetGlobalPrefAction<K extends keyof GlobalPrefs> = (
  value: GlobalPrefs[K],
) => void;

export function useGlobalPref<K extends keyof GlobalPrefs>(
  prefName: K,
  onSaveGlobalPrefs?: () => void,
): [GlobalPrefs[K], SetGlobalPrefAction<K>] {
  const { mutate: saveGlobalPrefs } = useSaveGlobalPrefsMutation();
  const saveGlobalPref: SetGlobalPrefAction<K> = value => {
    saveGlobalPrefs(
      {
        [prefName]: value,
      },
      {
        onSuccess: onSaveGlobalPrefs,
      },
    );
  };

  const { data: globalPref } = useQuery({
    ...prefQueries.listGlobal(),
    select: prefs => prefs?.[prefName],
    enabled: !!prefName,
    notifyOnChangeProps: ['data'],
  });

  return [globalPref as GlobalPrefs[K], saveGlobalPref];
}
