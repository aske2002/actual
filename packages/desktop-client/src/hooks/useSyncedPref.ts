import { useQuery } from '@tanstack/react-query';

import type { SyncedPrefs } from 'loot-core/types/prefs';

import { prefQueries, useSaveSyncedPrefsMutation } from '@desktop-client/prefs';

type SetSyncedPrefAction<K extends keyof SyncedPrefs> = (
  value: SyncedPrefs[K],
) => void;

export function useSyncedPref<K extends keyof SyncedPrefs>(
  prefName: K,
): [SyncedPrefs[K], SetSyncedPrefAction<K>] {
  const { mutate: saveSyncedPrefs } = useSaveSyncedPrefsMutation();
  const saveSyncedPref: SetSyncedPrefAction<K> = value => {
    saveSyncedPrefs({ [prefName]: value });
  };

  const { data: syncedPref } = useQuery({
    ...prefQueries.listSynced(),
    select: prefs => prefs?.[prefName],
    enabled: !!prefName,
    notifyOnChangeProps: ['data'],
  });

  return [syncedPref as SyncedPrefs[K], saveSyncedPref];
}
