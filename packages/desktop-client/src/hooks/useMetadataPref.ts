import { useQuery } from '@tanstack/react-query';

import type { MetadataPrefs } from 'loot-core/types/prefs';

import {
  prefQueries,
  useSaveMetadataPrefsMutation,
} from '@desktop-client/prefs';

type SetMetadataPrefAction<K extends keyof MetadataPrefs> = (
  value: MetadataPrefs[K],
) => void;

export function useMetadataPref<K extends keyof MetadataPrefs>(
  prefName: K,
): [MetadataPrefs[K], SetMetadataPrefAction<K>] {
  const { mutate: saveMetadataPrefs } = useSaveMetadataPrefsMutation();
  const saveMetadataPref: SetMetadataPrefAction<K> = value => {
    saveMetadataPrefs({ [prefName]: value });
  };

  const { data: metadataPref } = useQuery({
    ...prefQueries.listMetadata(),
    select: prefs => prefs?.[prefName],
    enabled: !!prefName,
    notifyOnChangeProps: ['data'],
  });

  return [metadataPref as MetadataPrefs[K], saveMetadataPref];
}
