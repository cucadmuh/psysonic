import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { invoke } from '@tauri-apps/api/core';
import { fetchLyrics, parseLrc, LrcLine } from '../api/lrclib';
import { fetchNeteaselyrics } from '../api/netease';
import { getLyricsBySongId, SubsonicStructuredLyrics } from '../api/subsonic';
import { useAuthStore } from '../store/authStore';
import { useOfflineStore } from '../store/offlineStore';
import { useHotCacheStore } from '../store/hotCacheStore';
import type { Track } from '../store/playerStore';

export type LyricsSource = 'server' | 'lrclib' | 'netease' | 'embedded';

export interface CachedLyrics {
  syncedLines: LrcLine[] | null;
  plainLyrics: string | null;
  source: LyricsSource | null;
  notFound: boolean;
}

// Session-level cache — survives tab switches and component unmount/remount.
export const lyricsCache = new Map<string, CachedLyrics>();

/** Convert structured Subsonic lyrics (ms timestamps) into LrcLine[] or plain text. */
export function parseStructuredLyrics(
  lyrics: SubsonicStructuredLyrics,
): Pick<CachedLyrics, 'syncedLines' | 'plainLyrics'> {
  // Accept both `synced` (OpenSubsonic spec) and `issynced` (legacy servers).
  const isSynced = !!(lyrics.synced ?? lyrics.issynced);
  if (isSynced && lyrics.line.length > 0) {
    const lines: LrcLine[] = lyrics.line
      .filter(l => l.start !== undefined)
      .map(l => ({ time: l.start! / 1000, text: l.value.trim() }))
      .sort((a, b) => a.time - b.time);
    if (lines.length > 0) return { syncedLines: lines, plainLyrics: null };
  }
  const plain = lyrics.line.map(l => l.value).join('\n').trim();
  return { syncedLines: null, plainLyrics: plain || null };
}

export interface UseLyricsResult {
  syncedLines: LrcLine[] | null;
  plainLyrics: string | null;
  source: LyricsSource | null;
  loading: boolean;
  notFound: boolean;
}

export function useLyrics(currentTrack: Track | null): UseLyricsResult {
  const cached = currentTrack ? lyricsCache.get(currentTrack.id) : undefined;
  const lyricsSources = useAuthStore(useShallow(s => s.lyricsSources));

  const [loading, setLoading]         = useState(!cached && !!currentTrack);
  const [syncedLines, setSyncedLines] = useState<LrcLine[] | null>(cached?.syncedLines ?? null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(cached?.plainLyrics ?? null);
  const [source, setSource]           = useState<LyricsSource | null>(cached?.source ?? null);
  const [notFound, setNotFound]       = useState(cached?.notFound ?? false);

  useEffect(() => {
    if (!currentTrack) return;

    const hit = lyricsCache.get(currentTrack.id);
    if (hit) {
      setSyncedLines(hit.syncedLines);
      setPlainLyrics(hit.plainLyrics);
      setSource(hit.source);
      setNotFound(hit.notFound);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setSyncedLines(null);
    setPlainLyrics(null);
    setSource(null);
    setNotFound(false);
    setLoading(true);

    const store = (entry: CachedLyrics) => {
      if (cancelled) return;
      lyricsCache.set(currentTrack.id, entry);
      setSyncedLines(entry.syncedLines);
      setPlainLyrics(entry.plainLyrics);
      setSource(entry.source);
      setNotFound(entry.notFound);
      setLoading(false);
    };

    // For offline / hot-cached tracks we have the file locally — read SYLT /
    // SYNCEDLYRICS directly via Rust instead of relying on Navidrome's parsing.
    // Fast path: both store lookups are synchronous; returns false immediately
    // for streaming tracks so it has zero impact on the normal fetch sequence.
    const fetchEmbedded = async (): Promise<boolean> => {
      const serverId = useAuthStore.getState().activeServerId ?? '';
      const localUrl =
        useOfflineStore.getState().getLocalUrl(currentTrack.id, serverId) ??
        useHotCacheStore.getState().getLocalUrl(currentTrack.id, serverId);
      if (!localUrl) return false;

      const prefix = 'psysonic-local://';
      const filePath = localUrl.startsWith(prefix) ? localUrl.slice(prefix.length) : null;
      if (!filePath) return false;

      try {
        const lrcString = await invoke<string | null>('get_embedded_lyrics', { path: filePath });
        if (!lrcString) return false;

        const lines = parseLrc(lrcString);
        const synced = lines.length > 0 ? lines : null;
        const plain  = synced ? null : (lrcString.trim() || null);
        if (!synced && !plain) return false;

        store({ syncedLines: synced, plainLyrics: plain, source: 'embedded', notFound: false });
        return true;
      } catch {
        return false;
      }
    };

    const fetchServer = async (): Promise<boolean> => {
      const structured = await getLyricsBySongId(currentTrack.id);
      if (!structured) return false;
      const parsed = parseStructuredLyrics(structured);
      if (!parsed.syncedLines && !parsed.plainLyrics) return false;
      store({ ...parsed, source: 'server', notFound: false });
      return true;
    };

    const fetchLrclibFn = async (): Promise<boolean> => {
      try {
        const result = await fetchLyrics(
          currentTrack.artist ?? '',
          currentTrack.title,
          currentTrack.album ?? '',
          currentTrack.duration ?? 0,
        );
        if (!result || (!result.syncedLyrics && !result.plainLyrics)) return false;
        const lines = result.syncedLyrics ? parseLrc(result.syncedLyrics) : null;
        const synced = lines && lines.length > 0 ? lines : null;
        store({ syncedLines: synced, plainLyrics: result.plainLyrics, source: 'lrclib', notFound: false });
        return true;
      } catch {
        return false;
      }
    };

    const NETEASE_META = /^(作词|作曲|编曲|制作人|出版|发行|MV导演|录音|混音|监制)/;
    const fetchNetease = async (): Promise<boolean> => {
      try {
        const lrc = await fetchNeteaselyrics(currentTrack.artist ?? '', currentTrack.title);
        if (!lrc) return false;
        const lines = parseLrc(lrc).filter(l => !NETEASE_META.test(l.text));
        const synced = lines.length > 0 ? lines : null;
        if (!synced) return false;
        store({ syncedLines: synced, plainLyrics: null, source: 'netease', notFound: false });
        return true;
      } catch {
        return false;
      }
    };

    const fetchFns: Record<string, () => Promise<boolean>> = {
      server: fetchServer,
      lrclib: fetchLrclibFn,
      netease: fetchNetease,
    };

    (async () => {
      // Embedded lyrics from local file always win (most accurate SYLT data).
      if (cancelled) return;
      if (await fetchEmbedded()) return;

      // Try enabled sources in user-defined order.
      for (const src of lyricsSources) {
        if (!src.enabled) continue;
        const fn = fetchFns[src.id];
        if (!fn) continue;
        if (cancelled) return;
        if (await fn()) return;
      }
      if (!cancelled) store({ syncedLines: null, plainLyrics: null, source: null, notFound: true });
    })();

    return () => { cancelled = true; };
  }, [currentTrack?.id, lyricsSources]); // eslint-disable-line react-hooks/exhaustive-deps

  return { syncedLines, plainLyrics, source, loading, notFound };
}
