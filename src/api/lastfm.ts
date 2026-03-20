import { invoke } from '@tauri-apps/api/core';

const API_KEY = import.meta.env.VITE_LASTFM_API_KEY as string;
const API_SECRET = import.meta.env.VITE_LASTFM_API_SECRET as string;

export function lastfmIsConfigured(): boolean {
  return Boolean(API_KEY && API_SECRET);
}

function errMsg(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function call(params: Record<string, string>, sign = false, get = false): Promise<any> {
  const entries = Object.entries(params) as [string, string][];
  return invoke('lastfm_request', {
    params: entries,
    sign,
    get,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
  });
}

export async function lastfmGetToken(): Promise<string> {
  try {
    const data = await call({ method: 'auth.getToken' }, false, true);
    return data.token as string;
  } catch (e) {
    throw new Error(errMsg(e));
  }
}

export function lastfmAuthUrl(token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${API_KEY}&token=${token}`;
}

export async function lastfmGetSession(token: string): Promise<{ key: string; name: string }> {
  try {
    const data = await call({ method: 'auth.getSession', token }, true, false);
    return { key: data.session.key as string, name: data.session.name as string };
  } catch (e) {
    throw new Error(errMsg(e));
  }
}

export async function lastfmGetSimilarArtists(artistName: string): Promise<string[]> {
  try {
    const data = await call({ method: 'artist.getSimilar', artist: artistName, limit: '50' }, false, true);
    const artists = data?.similarartists?.artist;
    if (!artists) return [];
    const arr = Array.isArray(artists) ? artists : [artists];
    return arr.map((a: any) => a.name as string);
  } catch {
    return [];
  }
}

export async function lastfmGetAllLovedTracks(
  username: string,
  sessionKey: string,
): Promise<Array<{ title: string; artist: string }>> {
  const results: Array<{ title: string; artist: string }> = [];
  let page = 1;
  const limit = 200;

  while (true) {
    try {
      const data = await call({
        method: 'user.getLovedTracks',
        user: username,
        sk: sessionKey,
        limit: String(limit),
        page: String(page),
      }, false, true);

      const tracks = data?.lovedtracks?.track;
      if (!tracks) break;
      const arr = Array.isArray(tracks) ? tracks : [tracks];
      for (const t of arr) {
        results.push({ title: t.name, artist: t.artist?.name ?? '' });
      }

      const totalPages = Number(data?.lovedtracks?.['@attr']?.totalPages ?? 1);
      if (page >= totalPages || page >= 10) break; // max 10 pages = 2000 tracks
      page++;
    } catch {
      break;
    }
  }

  return results;
}

export async function lastfmGetTrackLoved(
  title: string,
  artist: string,
  sessionKey: string,
): Promise<boolean> {
  try {
    const data = await call({ method: 'track.getInfo', track: title, artist, sk: sessionKey }, false, true);
    return data?.track?.userloved === '1' || data?.track?.userloved === 1;
  } catch {
    return false;
  }
}

export async function lastfmUpdateNowPlaying(
  track: { title: string; artist: string; album: string; duration: number },
  sessionKey: string,
): Promise<void> {
  try {
    await call({
      method: 'track.updateNowPlaying',
      track: track.title,
      artist: track.artist,
      album: track.album,
      duration: String(Math.round(track.duration)),
      sk: sessionKey,
    }, true, false);
  } catch {
    // best effort
  }
}

export async function lastfmLoveTrack(
  track: { title: string; artist: string },
  sessionKey: string,
): Promise<void> {
  try {
    await call({ method: 'track.love', track: track.title, artist: track.artist, sk: sessionKey }, true, false);
  } catch {
    // best effort
  }
}

export async function lastfmUnloveTrack(
  track: { title: string; artist: string },
  sessionKey: string,
): Promise<void> {
  try {
    await call({ method: 'track.unlove', track: track.title, artist: track.artist, sk: sessionKey }, true, false);
  } catch {
    // best effort
  }
}

export interface LastfmUserInfo {
  playcount: number;
  registeredAt: number; // unix timestamp
}

export async function lastfmGetUserInfo(
  username: string,
  sessionKey: string,
): Promise<LastfmUserInfo | null> {
  try {
    const data = await call({ method: 'user.getInfo', user: username, sk: sessionKey }, false, true);
    const u = data?.user;
    if (!u) return null;
    return {
      playcount: Number(u.playcount),
      registeredAt: Number(u.registered?.unixtime ?? 0),
    };
  } catch {
    return null;
  }
}

export interface LastfmRecentTrack {
  name: string;
  artist: string;
  album: string;
  timestamp: number | null; // null = currently playing
  nowPlaying: boolean;
}

export async function lastfmGetRecentTracks(
  username: string,
  sessionKey: string,
  limit = 20,
): Promise<LastfmRecentTrack[]> {
  try {
    const data = await call({ method: 'user.getRecentTracks', user: username, sk: sessionKey, limit: String(limit) }, false, true);
    const items = data?.recenttracks?.track;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map((t: any) => ({
      name: t.name,
      artist: t.artist?.['#text'] ?? t.artist?.name ?? '',
      album: t.album?.['#text'] ?? '',
      timestamp: t.date?.uts ? Number(t.date.uts) : null,
      nowPlaying: t['@attr']?.nowplaying === 'true',
    }));
  } catch {
    return [];
  }
}

export type LastfmPeriod = 'overall' | '7day' | '1month' | '3month' | '6month' | '12month';

export interface LastfmTopArtist {
  name: string;
  playcount: string;
}

export interface LastfmTopAlbum {
  name: string;
  playcount: string;
  artist: string;
}

export interface LastfmTopTrack {
  name: string;
  playcount: string;
  artist: string;
}

export async function lastfmGetTopArtists(
  username: string,
  sessionKey: string,
  period: LastfmPeriod,
  limit = 10,
): Promise<LastfmTopArtist[]> {
  try {
    const data = await call({ method: 'user.getTopArtists', user: username, sk: sessionKey, period, limit: String(limit) }, false, true);
    const items = data?.topartists?.artist;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map((a: any) => ({ name: a.name, playcount: a.playcount }));
  } catch {
    return [];
  }
}

export async function lastfmGetTopAlbums(
  username: string,
  sessionKey: string,
  period: LastfmPeriod,
  limit = 10,
): Promise<LastfmTopAlbum[]> {
  try {
    const data = await call({ method: 'user.getTopAlbums', user: username, sk: sessionKey, period, limit: String(limit) }, false, true);
    const items = data?.topalbums?.album;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map((a: any) => ({ name: a.name, playcount: a.playcount, artist: a.artist?.name ?? '' }));
  } catch {
    return [];
  }
}

export async function lastfmGetTopTracks(
  username: string,
  sessionKey: string,
  period: LastfmPeriod,
  limit = 10,
): Promise<LastfmTopTrack[]> {
  try {
    const data = await call({ method: 'user.getTopTracks', user: username, sk: sessionKey, period, limit: String(limit) }, false, true);
    const items = data?.toptracks?.track;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.map((t: any) => ({ name: t.name, playcount: t.playcount, artist: t.artist?.name ?? '' }));
  } catch {
    return [];
  }
}

export async function lastfmScrobble(
  track: { title: string; artist: string; album: string; duration: number },
  timestamp: number,
  sessionKey: string,
): Promise<void> {
  try {
    await call({
      method: 'track.scrobble',
      track: track.title,
      artist: track.artist,
      album: track.album,
      duration: String(Math.round(track.duration)),
      timestamp: String(Math.floor(timestamp / 1000)),
      sk: sessionKey,
    }, true, false);
  } catch {
    // best effort
  }
}
