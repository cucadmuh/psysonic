import { buildStreamUrl } from '../api/subsonic';
import { useOfflineStore } from '../store/offlineStore';
import { useHotCacheStore } from '../store/hotCacheStore';

/** Offline library → hot playback cache → HTTP stream. */
export function resolvePlaybackUrl(trackId: string, serverId: string): string {
  const offline = useOfflineStore.getState().getLocalUrl(trackId, serverId);
  if (offline) return offline;
  const hot = useHotCacheStore.getState().getLocalUrl(trackId, serverId);
  if (hot) return hot;
  return buildStreamUrl(trackId);
}
