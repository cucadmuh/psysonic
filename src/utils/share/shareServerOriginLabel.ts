import type { ServerProfile } from '../../store/authStoreTypes';
import { serverListDisplayLabel } from '../server/serverDisplayName';
import { findServerIdForShareUrl } from './shareLink';
import type { ShareSearchMatch } from './shareSearch';

/**
 * Display name for the share link's origin server when it differs from the
 * active server. Returns null when the link targets the active server, is
 * unsupported, or does not match any saved server profile.
 */
export function shareServerOriginLabel(
  shareMatch: ShareSearchMatch | null,
  servers: ServerProfile[],
  activeServerId: string | null,
): string | null {
  if (!shareMatch || shareMatch.type === 'unsupported') return null;

  const shareServerId = findServerIdForShareUrl(servers, shareMatch.payload.srv);
  if (!shareServerId || shareServerId === activeServerId) return null;

  const server = servers.find(s => s.id === shareServerId);
  if (!server) return null;

  return serverListDisplayLabel(server, servers);
}
