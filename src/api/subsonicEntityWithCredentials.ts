import { apiWithCredentials } from './subsonicClient';
import type { SubsonicAlbum, SubsonicArtist, SubsonicSong } from './subsonicTypes';

export async function getSongWithCredentials(
  serverUrl: string,
  username: string,
  password: string,
  id: string,
): Promise<SubsonicSong | null> {
  try {
    const data = await apiWithCredentials<{ song: SubsonicSong }>(
      serverUrl,
      username,
      password,
      'getSong.view',
      { id },
    );
    return data.song ?? null;
  } catch {
    return null;
  }
}

export async function getAlbumWithCredentials(
  serverUrl: string,
  username: string,
  password: string,
  id: string,
): Promise<{ album: SubsonicAlbum; songs: SubsonicSong[] }> {
  const data = await apiWithCredentials<{ album: SubsonicAlbum & { song: SubsonicSong[] } }>(
    serverUrl,
    username,
    password,
    'getAlbum.view',
    { id },
  );
  const { song, ...album } = data.album;
  return { album, songs: song ?? [] };
}

export async function getArtistWithCredentials(
  serverUrl: string,
  username: string,
  password: string,
  id: string,
): Promise<{ artist: SubsonicArtist; albums: SubsonicAlbum[] }> {
  const data = await apiWithCredentials<{ artist: SubsonicArtist & { album: SubsonicAlbum[] } }>(
    serverUrl,
    username,
    password,
    'getArtist.view',
    { id },
  );
  const { album, ...artist } = data.artist;
  return { artist, albums: album ?? [] };
}
