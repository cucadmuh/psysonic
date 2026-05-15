import md5 from 'md5';
import { useAuthStore } from '../store/authStore';
import { restBaseFromUrl, SUBSONIC_CLIENT, secureRandomSalt } from './subsonicClient';

function coverArtQueryParams(username: string, password: string, id: string, size: number): URLSearchParams {
  const salt = secureRandomSalt();
  const token = md5(password + salt);
  return new URLSearchParams({
    id,
    size: String(size),
    u: username,
    t: token,
    s: salt,
    v: '1.16.1',
    c: SUBSONIC_CLIENT,
    f: 'json',
  });
}

export function buildStreamUrl(id: string): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const salt = secureRandomSalt();
  const token = md5((server?.password ?? '') + salt);
  const p = new URLSearchParams({
    id,
    u: server?.username ?? '',
    t: token, s: salt, v: '1.16.1', c: SUBSONIC_CLIENT, f: 'json',
  });
  return `${baseUrl}/rest/stream.view?${p.toString()}`;
}

/** Stable cache key for cover art — does not include ephemeral auth params. */
export function coverArtCacheKey(id: string, size = 256): string {
  const server = useAuthStore.getState().getActiveServer();
  return coverArtCacheKeyForServer(server?.id ?? '_', id, size);
}

export function coverArtCacheKeyForServer(serverId: string, id: string, size = 256): string {
  return `${serverId}:cover:${id}:${size}`;
}

export function buildCoverArtUrl(id: string, size = 256): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const p = coverArtQueryParams(server?.username ?? '', server?.password ?? '', id, size);
  return `${baseUrl}/rest/getCoverArt.view?${p.toString()}`;
}

/** Cover art for a specific saved server (e.g. share-search preview on a non-active server). */
export function buildCoverArtUrlForServer(
  serverUrl: string,
  username: string,
  password: string,
  id: string,
  size = 256,
): string {
  const p = coverArtQueryParams(username, password, id, size);
  return `${restBaseFromUrl(serverUrl)}/getCoverArt.view?${p.toString()}`;
}

export function buildDownloadUrl(id: string): string {
  const { getBaseUrl, getActiveServer } = useAuthStore.getState();
  const server = getActiveServer();
  const baseUrl = getBaseUrl();
  const salt = secureRandomSalt();
  const token = md5((server?.password ?? '') + salt);
  const p = new URLSearchParams({
    id,
    u: server?.username ?? '',
    t: token, s: salt, v: '1.16.1', c: SUBSONIC_CLIENT, f: 'json',
  });
  return `${baseUrl}/rest/download.view?${p.toString()}`;
}
