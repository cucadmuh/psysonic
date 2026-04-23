import {
  filterSongsToActiveLibrary,
  getAlbum,
  getAlbumList,
  getRandomSongs,
  getSimilarSongs,
  getTopSongs,
  type SubsonicAlbum,
  type SubsonicSong,
} from '../api/subsonic';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../i18n';
import { useAuthStore } from '../store/authStore';
import { songToTrack, usePlayerStore } from '../store/playerStore';
import { useLuckyMixStore } from '../store/luckyMixStore';
import { showToast } from './toast';

interface TopArtist {
  id: string;
  name: string;
  totalPlays: number;
}

const MOST_PLAYED_PAGE_SIZE = 100;
const MOST_PLAYED_MAX_ALBUMS = 500;
const MIX_TARGET_SIZE = 50;
const SEED_TARGET_SIZE = 15;

function sampleRandom<T>(items: T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

function uniqueBySongId(items: SubsonicSong[]): SubsonicSong[] {
  const out: SubsonicSong[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

function uniqueAppend(base: SubsonicSong[], incoming: SubsonicSong[]): SubsonicSong[] {
  return uniqueBySongId([...base, ...incoming]);
}

function deriveTopArtistsFromFrequentAlbums(albums: SubsonicAlbum[]): TopArtist[] {
  const map = new Map<string, TopArtist>();
  for (const a of albums) {
    const plays = a.playCount ?? 0;
    if (!a.artistId || !a.artist || plays <= 0) continue;
    const prev = map.get(a.artistId);
    if (prev) {
      prev.totalPlays += plays;
      continue;
    }
    map.set(a.artistId, { id: a.artistId, name: a.artist, totalPlays: plays });
  }
  return [...map.values()].sort((a, b) => b.totalPlays - a.totalPlays);
}

async function fetchFrequentAlbumsPool(): Promise<SubsonicAlbum[]> {
  const out: SubsonicAlbum[] = [];
  let offset = 0;
  while (out.length < MOST_PLAYED_MAX_ALBUMS) {
    const page = await getAlbumList('frequent', MOST_PLAYED_PAGE_SIZE, offset);
    if (!page.length) break;
    out.push(...page);
    if (page.length < MOST_PLAYED_PAGE_SIZE) break;
    offset += MOST_PLAYED_PAGE_SIZE;
  }
  return out;
}

async function pickSongsForArtist(artist: TopArtist, need: number): Promise<SubsonicSong[]> {
  const primary = uniqueBySongId(await filterSongsToActiveLibrary(await getTopSongs(artist.name)));
  if (primary.length >= need) return sampleRandom(primary, need);

  const extra: SubsonicSong[] = [];
  for (let i = 0; i < 8 && primary.length + extra.length < need; i++) {
    const rnd = await filterSongsToActiveLibrary(await getRandomSongs(120));
    for (const s of rnd) {
      if (s.artistId === artist.id || s.artist === artist.name) {
        extra.push(s);
      }
    }
  }
  return sampleRandom(uniqueBySongId([...primary, ...extra]), need);
}

async function pickSongsForAlbum(albumId: string, need: number): Promise<SubsonicSong[]> {
  const full = await getAlbum(albumId).catch(() => null);
  if (!full?.songs?.length) return [];
  const scopedSongs = await filterSongsToActiveLibrary(full.songs);
  return sampleRandom(uniqueBySongId(scopedSongs), need);
}

async function pickGoodRatedSongs(existingIds: Set<string>, need: number): Promise<SubsonicSong[]> {
  const out: SubsonicSong[] = [];
  const push = (s: SubsonicSong) => {
    const r = s.userRating ?? 0;
    if (r < 4) return;
    if (existingIds.has(s.id)) return;
    if (out.some(x => x.id === s.id)) return;
    out.push(s);
  };

  for (let i = 0; i < 14 && out.length < need; i++) {
    const rnd = await filterSongsToActiveLibrary(await getRandomSongs(120));
    rnd.forEach(push);
  }

  return sampleRandom(out, need);
}

export async function buildAndPlayLuckyMix(): Promise<void> {
  const lucky = useLuckyMixStore.getState();
  if (lucky.isRolling) return;
  const auth = useAuthStore.getState();
  const debugEnabled = auth.loggingMode === 'debug';
  const debugSteps: Array<{ step: string; details?: unknown }> = [];
  const logStep = (step: string, details?: unknown) => {
    if (!debugEnabled) return;
    const payload = { step, details };
    debugSteps.push(payload);
    console.debug('[psysonic][lucky-mix]', payload);
    void invoke('frontend_debug_log', {
      scope: 'lucky-mix',
      message: JSON.stringify(payload),
    }).catch(() => {});
  };
  const songDebug = (songs: SubsonicSong[]) =>
    songs.map(s => ({ id: s.id, title: s.title, artist: s.artist, rating: s.userRating ?? 0 }));
  const albumDebug = (albums: SubsonicAlbum[]) =>
    albums.map(a => ({ id: a.id, name: a.name, artist: a.artist, playCount: a.playCount ?? 0 }));
  const activeServerId = auth.activeServerId;
  const audiomuseEnabled = Boolean(activeServerId && auth.audiomuseNavidromeByServer[activeServerId]);
  logStep('init', {
    activeServerId,
    audiomuseEnabled,
    showLuckyMixMenu: auth.showLuckyMixMenu,
    libraryFilter: activeServerId ? (auth.musicLibraryFilterByServer[activeServerId] ?? 'all') : 'all',
  });
  if (!auth.showLuckyMixMenu || !audiomuseEnabled) {
    logStep('abort_unavailable');
    showToast(i18n.t('luckyMix.unavailable'), 4000, 'warning');
    return;
  }

  // Drop the old "upcoming" tail immediately so the queue UI does not show stale
  // next tracks while the mix is still building (first playTrack may be delayed).
  usePlayerStore.getState().pruneUpcomingToCurrent();

  lucky.start();
  try {
    const queuedIds = new Set<string>();
    let allSeedSongs: SubsonicSong[] = [];
    let startedPlayback = false;
    const reachedTarget = () => queuedIds.size >= MIX_TARGET_SIZE;
    const isBlockedByRating = (song: SubsonicSong) => {
      const rating = song.userRating ?? 0;
      return rating === 1 || rating === 2;
    };

    const startImmediatePlayback = (song: SubsonicSong, source: string) => {
      if (startedPlayback || !song?.id || isBlockedByRating(song)) return;
      startedPlayback = true;
      queuedIds.add(song.id);
      const track = songToTrack(song);
      usePlayerStore.getState().playTrack(track, [track], true);
      logStep('start_immediate_playback', {
        source,
        song: songDebug([song])[0],
        queuedCount: queuedIds.size,
      });
    };

    const appendSongsToQueue = (songs: SubsonicSong[], reason: string): number => {
      if (reachedTarget()) return 0;
      if (!songs.length) return 0;
      const deduped = uniqueBySongId(songs).filter(s => !queuedIds.has(s.id) && !isBlockedByRating(s));
      if (!deduped.length) return 0;

      const candidates = [...deduped];
      if (!startedPlayback && candidates.length > 0) {
        const first = candidates.shift();
        if (first) startImmediatePlayback(first, reason);
      }

      if (!candidates.length) return 0;
      const remaining = Math.max(0, MIX_TARGET_SIZE - queuedIds.size);
      if (remaining <= 0) return 0;
      const toAdd = sampleRandom(candidates, Math.min(remaining, candidates.length));
      if (!toAdd.length) return 0;
      toAdd.forEach(s => queuedIds.add(s.id));
      usePlayerStore.getState().enqueue(toAdd.map(songToTrack));
      logStep('append_queue_batch', {
        reason,
        added: toAdd.length,
        queuedCount: queuedIds.size,
        songs: songDebug(toAdd),
      });
      return toAdd.length;
    };

    const frequentAlbums = await fetchFrequentAlbumsPool();
    const albumsWithPlays = frequentAlbums.filter(a => (a.playCount ?? 0) > 0);
    logStep('fetch_frequent_albums', {
      fetched: frequentAlbums.length,
      withPlays: albumsWithPlays.length,
    });
    const topArtists = deriveTopArtistsFromFrequentAlbums(albumsWithPlays);
    const pickedArtists = sampleRandom(topArtists, 2);
    logStep('pick_top_artists', {
      topArtistsCount: topArtists.length,
      pickedArtists,
    });

    for (const artist of pickedArtists) {
      const songs = await pickSongsForArtist(artist, 3);
      allSeedSongs = uniqueAppend(allSeedSongs, songs);
      const firstPlayable = songs.find(s => !isBlockedByRating(s));
      if (firstPlayable) startImmediatePlayback(firstPlayable, `artist:${artist.name}`);
      logStep('pick_artist_songs', {
        artist,
        pickedCount: songs.length,
        songs: songDebug(songs),
      });
    }

    const pickedAlbums = sampleRandom(albumsWithPlays, 2);
    logStep('pick_top_albums', {
      poolCount: albumsWithPlays.length,
      pickedAlbums: albumDebug(pickedAlbums),
    });
    for (const album of pickedAlbums) {
      const songs = await pickSongsForAlbum(album.id, 3);
      allSeedSongs = uniqueAppend(allSeedSongs, songs);
      const firstPlayable = songs.find(s => !isBlockedByRating(s));
      if (firstPlayable) startImmediatePlayback(firstPlayable, `album:${album.id}`);
      logStep('pick_album_songs', {
        albumId: album.id,
        pickedCount: songs.length,
        songs: songDebug(songs),
      });
    }

    const rated = await pickGoodRatedSongs(new Set(allSeedSongs.map(s => s.id)), 3);
    logStep('pick_rated_songs_4plus_only', {
      ratedPickedCount: rated.length,
      ratedSongs: songDebug(rated),
    });
    allSeedSongs = uniqueAppend(allSeedSongs, rated);
    let seeds = allSeedSongs.filter(s => !isBlockedByRating(s));
    logStep('seed_after_dedup', {
      seedCount: seeds.length,
      seeds: songDebug(seeds),
    });

    if (seeds.length < SEED_TARGET_SIZE) {
      logStep('seed_fill_start', { target: SEED_TARGET_SIZE, before: seeds.length });
      for (let i = 0; i < 10 && seeds.length < SEED_TARGET_SIZE; i++) {
        const rnd = await filterSongsToActiveLibrary(await getRandomSongs(80));
        const allowedRnd = rnd.filter(s => !isBlockedByRating(s));
        seeds = uniqueAppend(seeds, allowedRnd);
        const firstPlayable = allowedRnd[0];
        if (firstPlayable) startImmediatePlayback(firstPlayable, `seed-fill-batch:${i + 1}`);
        logStep('seed_fill_batch', {
          batch: i + 1,
          fetched: rnd.length,
          seedCount: seeds.length,
        });
      }
      seeds = seeds.slice(0, SEED_TARGET_SIZE);
      logStep('seed_fill_end', {
        finalSeedCount: seeds.length,
        seeds: songDebug(seeds),
      });
    }

    if (seeds.length === 0) {
      throw new Error('no-seeds');
    }
    if (!startedPlayback) {
      const firstPlayableSeed = seeds.find(s => !isBlockedByRating(s));
      if (firstPlayableSeed) startImmediatePlayback(firstPlayableSeed, 'seed-fallback-first');
    }

    let similarRaw: SubsonicSong[] = [];
    let similar: SubsonicSong[] = [];
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const oneRaw = await getSimilarSongs(seed.id, 60).catch(() => [] as SubsonicSong[]);
      const oneScoped = await filterSongsToActiveLibrary(oneRaw);
      similarRaw = uniqueAppend(similarRaw, oneRaw);
      similar = uniqueAppend(similar, oneScoped);
      appendSongsToQueue(oneScoped, `similar-seed-${i + 1}/${seeds.length}`);
      if (reachedTarget()) break;
    }
    const seedForPool = seeds.filter(() => Math.random() < 0.5);
    let pool = uniqueBySongId([...seedForPool, ...similar]);
    appendSongsToQueue(seedForPool, 'seed-50pct');
    logStep('instant_mix', {
      seedUsedForInstantMixCount: seeds.length,
      seedIncludedInPoolCount: seedForPool.length,
      seedIncludedInPool: songDebug(seedForPool),
      similarRawCount: similarRaw.length,
      similarScopedCount: similar.length,
      initialPoolCount: pool.length,
    });

    for (let i = 0; i < 10 && pool.length < MIX_TARGET_SIZE; i++) {
      const rnd = await filterSongsToActiveLibrary(await getRandomSongs(120));
      pool = uniqueAppend(pool, rnd);
      appendSongsToQueue(rnd, `pool-fill-${i + 1}`);
      logStep('pool_fill_batch', {
        batch: i + 1,
        fetched: rnd.length,
        poolCount: pool.length,
      });
      if (reachedTarget()) break;
    }

    const finalSongs = sampleRandom(pool, MIX_TARGET_SIZE).filter(s => !queuedIds.has(s.id));
    appendSongsToQueue(finalSongs, 'finalize-randomized');
    logStep('final_queue_state', {
      poolCount: pool.length,
      queuedCount: queuedIds.size,
      queuedTarget: MIX_TARGET_SIZE,
    });
    if (queuedIds.size === 0) {
      throw new Error('empty-mix');
    }
    showToast(i18n.t('luckyMix.done', { count: queuedIds.size }), 3500, 'success');
    logStep('done', { queueCount: queuedIds.size });
    if (debugEnabled) {
      console.debug('[psysonic][lucky-mix] full-steps', debugSteps);
      void invoke('frontend_debug_log', {
        scope: 'lucky-mix',
        message: JSON.stringify({ step: 'full-steps', details: debugSteps }),
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[psysonic] lucky mix failed:', err);
    logStep('failed', { error: String(err) });
    if (debugEnabled) {
      console.debug('[psysonic][lucky-mix] full-steps', debugSteps);
      void invoke('frontend_debug_log', {
        scope: 'lucky-mix',
        message: JSON.stringify({ step: 'full-steps', details: debugSteps }),
      }).catch(() => {});
    }
    showToast(i18n.t('luckyMix.failed'), 5000, 'error');
  } finally {
    useLuckyMixStore.getState().stop();
  }
}
