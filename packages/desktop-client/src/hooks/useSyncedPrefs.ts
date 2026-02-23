import { useQuery } from '@tanstack/react-query';

import type { SyncedPrefs } from 'loot-core/types/prefs';

import { prefQueries, useSaveSyncedPrefsMutation } from '@desktop-client/prefs';

type SetSyncedPrefsAction = (value: Partial<SyncedPrefs>) => void;

/** @deprecated: please use `useSyncedPref` (singular) */
export function useSyncedPrefs(): [SyncedPrefs, SetSyncedPrefsAction] {
  const { mutate: saveSyncedPrefs } = useSaveSyncedPrefsMutation();
  const { data: syncedPrefs } = useQuery(prefQueries.listSynced());

  return [syncedPrefs as SyncedPrefs, saveSyncedPrefs];
}
