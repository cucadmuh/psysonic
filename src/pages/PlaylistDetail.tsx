import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Play, ListPlus, Trash2, Search, X, Loader2, Plus, GripVertical, Star, RefreshCw, Shuffle, Heart, HardDriveDownload, Check } from 'lucide-react';
import { AddToPlaylistSubmenu } from '../components/ContextMenu';
import {
  getPlaylist, updatePlaylist, search, setRating, star, unstar,
  getRandomSongs, SubsonicPlaylist, SubsonicSong,
} from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { usePlaylistStore } from '../store/playlistStore';
import { useOfflineStore } from '../store/offlineStore';
import { useAuthStore } from '../store/authStore';
import { useDragDrop } from '../contexts/DragDropContext';
import CachedImage, { useCachedUrl } from '../components/CachedImage';
import { coverArtCacheKey, buildCoverArtUrl } from '../api/subsonic';
import { useTranslation } from 'react-i18next';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function totalDurationLabel(songs: SubsonicSong[]): string {
  const total = songs.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function codecLabel(song: SubsonicSong): string {
  const parts: string[] = [];
  if (song.suffix) parts.push(song.suffix.toUpperCase());
  if (song.bitRate) parts.push(`${song.bitRate} kbps`);
  return parts.join(' · ');
}

function StarRating({ value, onChange }: { value: number; onChange: (r: number) => void }) {
  const [hover, setHover] = React.useState(0);
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`star ${(hover || value) >= n ? 'filled' : ''}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
        >★</button>
      ))}
    </div>
  );
}

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playTrack, enqueue, openContextMenu, currentTrack, isPlaying, starredOverrides, setStarredOverride } = usePlayerStore(
    useShallow(s => ({
      playTrack: s.playTrack,
      enqueue: s.enqueue,
      openContextMenu: s.openContextMenu,
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
      starredOverrides: s.starredOverrides,
      setStarredOverride: s.setStarredOverride,
    }))
  );
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const { startDrag, isDragging } = useDragDrop();
  const { downloadPlaylist, isAlbumDownloading, isAlbumDownloaded, getAlbumProgress } = useOfflineStore();
  const activeServerId = useAuthStore(s => s.activeServerId) ?? '';

  const [playlist, setPlaylist] = useState<SubsonicPlaylist | null>(null);
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [starredSongs, setStarredSongs] = useState<Set<string>>(new Set());
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState<string | null>(null);
  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);

  // ── Bulk select ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [showBulkPlPicker, setShowBulkPlPicker] = useState(false);

  const toggleSelect = (id: string, idx: number, shift: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shift && lastSelectedIdx !== null) {
        const from = Math.min(lastSelectedIdx, idx);
        const to = Math.max(lastSelectedIdx, idx);
        songs.slice(from, to + 1).forEach(s => next.add(s.id));
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastSelectedIdx(idx);
  };

  const allSelected = selectedIds.size === songs.length && songs.length > 0;
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(songs.map(s => s.id)));

  const bulkRemove = () => {
    const prevCount = songs.length;
    const next = songs.filter(s => !selectedIds.has(s.id));
    setSongs(next);
    savePlaylist(next, prevCount);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (!showBulkPlPicker) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.bulk-pl-picker-wrap')) setShowBulkPlPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBulkPlPicker]);

  // ── 2×2 cover quad (first 4 unique album covers) ─────────────
  const coverQuad = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of songs) {
      if (s.coverArt && !seen.has(s.coverArt)) {
        seen.add(s.coverArt);
        result.push(s.coverArt);
        if (result.length === 4) break;
      }
    }
    return result;
  }, [songs]);

  // Stable fetch URLs + cache keys for the 2×2 grid and blurred background.
  // buildCoverArtUrl generates a new crypto salt on every call, so these MUST
  // be memoized — otherwise every render produces new URLs, useCachedUrl
  // re-triggers, state updates, another render → infinite flicker loop.
  const coverQuadUrls = useMemo(() =>
    Array.from({ length: 4 }, (_, i) => {
      const coverId = coverQuad[i % Math.max(1, coverQuad.length)];
      if (!coverId) return null;
      return { src: buildCoverArtUrl(coverId, 200), cacheKey: coverArtCacheKey(coverId, 200) };
    }),
  [coverQuad]);

  const bgFetchUrl = useMemo(() => buildCoverArtUrl(coverQuad[0] ?? '', 300), [coverQuad]);
  const bgCacheKey = useMemo(() => coverArtCacheKey(coverQuad[0] ?? '', 300), [coverQuad]);
  const resolvedBgUrl = useCachedUrl(bgFetchUrl, bgCacheKey);

  // Song search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SubsonicSong[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suggestions
  const [suggestions, setSuggestions] = useState<SubsonicSong[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // DnD
  const tracklistRef = useRef<HTMLDivElement>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<{ idx: number; before: boolean } | null>(null);

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  // ── Load ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getPlaylist(id)
      .then(({ playlist, songs }) => {
        setPlaylist(playlist);
        setSongs(songs);
        const init: Record<string, number> = {};
        const starred = new Set<string>();
        songs.forEach(s => {
          if (s.userRating) init[s.id] = s.userRating;
          if (s.starred) starred.add(s.id);
        });
        setRatings(init);
        setStarredSongs(starred);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // ── Suggestions ───────────────────────────────────────────────
  const loadSuggestions = useCallback(async (currentSongs: SubsonicSong[]) => {
    if (!currentSongs.length) return;
    // Count genres across playlist songs, pick the most common one
    const genreCounts: Record<string, number> = {};
    for (const s of currentSongs) {
      if (s.genre) genreCounts[s.genre] = (genreCounts[s.genre] ?? 0) + 1;
    }
    const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
    // Fall back to no genre filter if none of the songs have genre tags
    const genre = genres.length > 0 ? genres[Math.floor(Math.random() * Math.min(3, genres.length))][0] : undefined;
    const existingIds = new Set(currentSongs.map(s => s.id));
    setLoadingSuggestions(true);
    setSuggestions([]);
    try {
      const random = await getRandomSongs(25, genre);
      setSuggestions(random.filter(s => !existingIds.has(s.id)).slice(0, 10));
    } catch {}
    setLoadingSuggestions(false);
  }, []);

  useEffect(() => {
    if (songs.length > 0) loadSuggestions(songs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist?.id]);

  // ── Save ──────────────────────────────────────────────────────
  const savePlaylist = useCallback(async (updatedSongs: SubsonicSong[], prevCount = 0) => {
    if (!id) return;
    setSaving(true);
    try {
      await updatePlaylist(id, updatedSongs.map(s => s.id), prevCount);
      if (id) touchPlaylist(id);
    } catch {}
    setSaving(false);
  }, [id, touchPlaylist]);

  // ── Remove ────────────────────────────────────────────────────
  const removeSong = (idx: number) => {
    const prevCount = songs.length;
    const next = songs.filter((_, i) => i !== idx);
    setSongs(next);
    savePlaylist(next, prevCount);
  };

  // ── Add ───────────────────────────────────────────────────────
  const addSong = (song: SubsonicSong) => {
    if (songs.some(s => s.id === song.id)) return;
    const next = [...songs, song];
    setSongs(next);
    savePlaylist(next);
    setSuggestions(prev => prev.filter(s => s.id !== song.id));
    setSearchResults(prev => prev.filter(s => s.id !== song.id));
  };

  // ── Rating / Star ─────────────────────────────────────────────
  const handleRate = (songId: string, rating: number) => {
    setRatings(prev => ({ ...prev, [songId]: rating }));
    setRating(songId, rating).catch(() => {});
  };

  const handleToggleStar = (song: SubsonicSong, e: React.MouseEvent) => {
    e.stopPropagation();
    const isStarred = song.id in starredOverrides ? starredOverrides[song.id] : starredSongs.has(song.id);
    setStarredSongs(prev => {
      const next = new Set(prev);
      isStarred ? next.delete(song.id) : next.add(song.id);
      return next;
    });
    setStarredOverride(song.id, !isStarred);
    (isStarred ? unstar(song.id, 'song') : star(song.id, 'song')).catch(() => {});
  };

  // ── Search ────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) { setSearchResults([]); return; }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await search(searchQuery, { songCount: 20, artistCount: 0, albumCount: 0 });
        const existingIds = new Set(songs.map(s => s.id));
        setSearchResults(res.songs.filter(s => !existingIds.has(s.id)));
      } catch {}
      setSearching(false);
    }, 350);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery, searchOpen, songs]);

  // ── psy-drop DnD reordering ───────────────────────────────────
  useEffect(() => {
    const container = tracklistRef.current;
    if (!container) return;

    const onPsyDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.data) return;
      let parsed: any;
      try { parsed = JSON.parse(detail.data); } catch { return; }
      if (parsed.type !== 'playlist_reorder') return;

      setDropTargetIdx(null);

      const fromIdx: number = parsed.index;

      // Determine drop index from the event target row
      const target = (e.target as HTMLElement).closest('[data-track-idx]');
      let toIdx = songs.length;
      if (target) {
        const targetIdx = parseInt(target.getAttribute('data-track-idx') ?? '', 10);
        const rect = target.getBoundingClientRect();
        const cursorY = (e as CustomEvent & { clientY?: number }).clientY ?? (rect.top + rect.height / 2);
        const before = cursorY < rect.top + rect.height / 2;
        toIdx = before ? targetIdx : targetIdx + 1;
      }

      if (fromIdx === toIdx || fromIdx === toIdx - 1) return;

      setSongs(prev => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
        next.splice(insertAt, 0, moved);
        savePlaylist(next);
        return next;
      });
    };

    container.addEventListener('psy-drop', onPsyDrop);
    return () => container.removeEventListener('psy-drop', onPsyDrop);
  }, [songs, savePlaylist]);

  // ── Row mousedown: threshold drag for reorder (from anywhere on the row) ──
  const handleRowMouseDown = (e: React.MouseEvent, idx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const onMove = (me: MouseEvent) => {
      if (Math.abs(me.clientX - sx) > 5 || Math.abs(me.clientY - sy) > 5) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        startDrag(
          { data: JSON.stringify({ type: 'playlist_reorder', index: idx }), label: songs[idx]?.title ?? '' },
          me.clientX, me.clientY
        );
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Memoized derivations ──────────────────────────────────────
  const existingIds = useMemo(() => new Set(songs.map(s => s.id)), [songs]);
  const tracks = useMemo(() => songs.map(songToTrack), [songs]);

  // ── Drag-over visual feedback ─────────────────────────────────
  const handleRowMouseEnter = (idx: number, e: React.MouseEvent) => {
    if (!isDragging) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropTargetIdx({ idx, before });
  };

  // ── Render ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!playlist) {
    return <div className="content-body"><div className="empty-state">{t('playlists.notFound')}</div></div>;
  }

  return (
    <div className="content-body animate-fade-in">

      {/* ── Hero ── */}
      <div className="album-detail-header">
        {resolvedBgUrl && (
          <div className="album-detail-bg" style={{ backgroundImage: `url(${resolvedBgUrl})` }} aria-hidden="true" />
        )}
        <div className="album-detail-overlay" aria-hidden="true" />

        <div className="album-detail-content">
          <button className="btn btn-ghost album-detail-back" onClick={() => navigate('/playlists')}>
            <ChevronLeft size={16} /> {t('playlists.title')}
          </button>

          <div className="album-detail-hero">
            {/* 2×2 cover grid */}
            <div className="playlist-cover-grid">
              {coverQuadUrls.map((entry, i) =>
                entry
                  ? <CachedImage key={i} className="playlist-cover-cell" src={entry.src} cacheKey={entry.cacheKey} alt="" />
                  : <div key={i} className="playlist-cover-cell playlist-cover-cell--empty" />
              )}
            </div>

            <div className="album-detail-meta">
              <span className="badge album-detail-badge">{t('playlists.titleBadge')}</span>
              <h1 className="album-detail-title">{playlist.name}</h1>
              <div className="album-detail-info">
                <span>{t('playlists.songs', { n: songs.length })}</span>
                {songs.length > 0 && <span>· {totalDurationLabel(songs)}</span>}
                {saving && <Loader2 size={12} className="spin-slow" style={{ display: 'inline', marginLeft: 4 }} />}
              </div>
              <div className="album-detail-actions">
                <div className="album-detail-actions-primary">
                  <button className="btn btn-primary" disabled={songs.length === 0} onClick={() => {
                    if (!songs.length) return;
                    touchPlaylist(id!);
                    playTrack(tracks[0], tracks);
                  }}>
                    <Play size={16} fill="currentColor" /> {t('playlists.playAll')}
                  </button>
                  <button className="btn btn-surface" disabled={songs.length === 0} onClick={() => {
                    if (!songs.length) return;
                    touchPlaylist(id!);
                    const shuffled = [...tracks];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1));
                      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    playTrack(shuffled[0], shuffled);
                  }}>
                    <Shuffle size={16} /> {t('playlists.shuffle', 'Shuffle')}
                  </button>
                  <button className="btn btn-surface" disabled={songs.length === 0} onClick={() => {
                    if (!songs.length) return;
                    touchPlaylist(id!);
                    enqueue(tracks);
                  }}>
                    <ListPlus size={16} /> {t('playlists.addToQueue')}
                  </button>
                </div>
                <button
                  className={`btn btn-ghost ${searchOpen ? 'active' : ''}`}
                  onClick={() => { setSearchOpen(v => !v); setSearchQuery(''); setSearchResults([]); }}
                >
                  <Search size={16} /> {t('playlists.addSongs')}
                </button>
                {songs.length > 0 && id && (() => {
                  const isDownloading = isAlbumDownloading(id);
                  const isCached = isAlbumDownloaded(id, activeServerId);
                  const progress = isDownloading ? getAlbumProgress(id) : null;
                  return (
                    <button
                      className="btn btn-ghost"
                      disabled={isDownloading}
                      onClick={() => { if (playlist) downloadPlaylist(id, playlist.name, playlist.coverArt, songs, activeServerId); }}
                      data-tooltip={isDownloading
                        ? t('albumDetail.offlineDownloading', { n: progress?.done ?? 0, total: progress?.total ?? 0 })
                        : isCached ? t('playlists.offlineCached') : t('playlists.cacheOffline')}
                    >
                      {isDownloading
                        ? <div className="spinner" style={{ width: 14, height: 14, borderTopColor: 'currentColor' }} />
                        : isCached ? <Check size={16} /> : <HardDriveDownload size={16} />}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Song search panel ── */}
      {searchOpen && (
        <div className="playlist-search-panel">
          <div className="playlist-search-input-wrap">
            <input
              className="input"
              placeholder={t('playlists.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button className="live-search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); }}>
                <X size={14} />
              </button>
            )}
          </div>
          {searching && <div style={{ textAlign: 'center', padding: '0.75rem' }}><div className="spinner" /></div>}
          {!searching && searchQuery && searchResults.length === 0 && (
            <div className="empty-state" style={{ padding: '0.5rem 0' }}>{t('playlists.noResults')}</div>
          )}
          {searchResults.map(song => (
            <div key={song.id} className="playlist-search-row" style={{ cursor: 'pointer' }} onClick={() => addSong(song)}>
              <CachedImage src={buildCoverArtUrl(song.coverArt ?? '', 40)} cacheKey={coverArtCacheKey(song.coverArt ?? '', 40)} alt="" className="playlist-search-thumb" />
              <div className="playlist-search-info">
                <span className="playlist-search-title">{song.title}</span>
                <span className="playlist-search-artist">{song.artist} · <span className="playlist-search-album">{song.album}</span></span>
              </div>
              <span className="playlist-search-duration">{formatDuration(song.duration ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Tracklist ── */}
      <div className="tracklist" ref={tracklistRef}>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bulk-action-bar">
            <span className="bulk-action-count">
              {t('common.bulkSelected', { count: selectedIds.size })}
            </span>
            <div className="bulk-pl-picker-wrap">
              <button
                className="btn btn-surface btn-sm"
                onClick={() => setShowBulkPlPicker(v => !v)}
              >
                <ListPlus size={14} />
                {t('common.bulkAddToPlaylist')}
              </button>
              {showBulkPlPicker && (
                <AddToPlaylistSubmenu
                  songIds={[...selectedIds]}
                  onDone={() => { setShowBulkPlPicker(false); setSelectedIds(new Set()); }}
                  dropDown
                />
              )}
            </div>
            <button
              className="btn btn-surface btn-sm"
              style={{ color: 'var(--danger)' }}
              onClick={bulkRemove}
            >
              <Trash2 size={14} />
              {t('common.bulkRemoveFromPlaylist')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedIds(new Set())}
            >
              <X size={13} />
              {t('common.bulkClear')}
            </button>
          </div>
        )}

        {/* Header */}
        <div className="tracklist-header tracklist-va tracklist-playlist">
          <div className="col-center" style={{ cursor: songs.length > 0 ? 'pointer' : undefined }} onClick={songs.length > 0 ? toggleAll : undefined}>
            {selectedIds.size > 0
              ? <span className={`bulk-check${allSelected ? ' checked' : ''}`} />
              : '#'}
          </div>
          <div>{t('albumDetail.trackTitle')}</div>
          <div>{t('albumDetail.trackArtist')}</div>
          <div className="col-center">{t('albumDetail.trackFavorite')}</div>
          <div className="col-center">{t('albumDetail.trackRating')}</div>
          <div className="col-center">{t('albumDetail.trackDuration')}</div>
          <div>{t('albumDetail.trackFormat')}</div>
          <div />
        </div>

        {songs.length === 0 && (
          <div className="empty-state" style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <span>{t('playlists.emptyPlaylist')}</span>
            <button className="btn btn-primary" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
              {t('playlists.addFirstSong')}
            </button>
          </div>
        )}

        {songs.map((song, idx) => (
          <React.Fragment key={song.id + idx}>
            {isDragging && dropTargetIdx?.idx === idx && dropTargetIdx.before && (
              <div className="playlist-drop-indicator" />
            )}
            <div
              data-track-idx={idx}
              className={`track-row track-row-va tracklist-playlist${currentTrack?.id === song.id ? ' active' : ''}${contextMenuSongId === song.id ? ' context-active' : ''}${selectedIds.has(song.id) ? ' bulk-selected' : ''}`}
              onMouseEnter={e => handleRowMouseEnter(idx, e)}
              onMouseDown={e => handleRowMouseDown(e, idx)}
              onClick={e => {
                if ((e.target as HTMLElement).closest('button, a, input')) return;
                if (selectedIds.size > 0) {
                  toggleSelect(song.id, idx, e.shiftKey);
                } else {
                  playTrack(tracks[idx], tracks);
                }
              }}
              onContextMenu={e => {
                e.preventDefault();
                setContextMenuSongId(song.id);
                openContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
              }}
            >
              {/* # — checkbox in select mode, always-visible play button otherwise */}
              {(() => {
                const inSelectMode = selectedIds.size > 0;
                return (
                  <div
                    className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={e => {
                      e.stopPropagation();
                      playTrack(tracks[idx], tracks);
                    }}
                  >
                    <span
                      className={`bulk-check${selectedIds.has(song.id) ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
                      onClick={e => { e.stopPropagation(); toggleSelect(song.id, idx, e.shiftKey); }}
                    />
                    {currentTrack?.id === song.id && isPlaying && <span className="track-num-eq"><div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div></span>}
                    <span className="track-num-play"><Play size={13} fill="currentColor" /></span>
                    <span className="track-num-number">{idx + 1}</span>
                  </div>
                );
              })()}

              {/* Title */}
              <div className="track-info">
                <span className="track-title">{song.title}</span>
              </div>

              {/* Artist */}
              <div className="track-artist-cell">
                <span
                  className={`track-artist${song.artistId ? ' track-artist-link' : ''}`}
                  style={{ cursor: song.artistId ? 'pointer' : 'default' }}
                  onClick={e => { if (song.artistId) { e.stopPropagation(); navigate(`/artist/${song.artistId}`); } }}
                >{song.artist}</span>
              </div>

              {/* Favorite */}
              <div className="track-star-cell">
                <button
                  className="btn btn-ghost track-star-btn"
                  onClick={e => handleToggleStar(song, e)}
                  style={{ color: (song.id in starredOverrides ? starredOverrides[song.id] : starredSongs.has(song.id)) ? 'var(--color-star-active, var(--accent))' : 'var(--color-star-inactive, var(--text-muted))' }}
                >
                  <Heart size={14} fill={(song.id in starredOverrides ? starredOverrides[song.id] : starredSongs.has(song.id)) ? 'currentColor' : 'none'} />
                </button>
              </div>

              {/* Rating */}
              <StarRating value={ratings[song.id] ?? song.userRating ?? 0} onChange={r => handleRate(song.id, r)} />

              {/* Duration */}
              <div className="track-duration">{formatDuration(song.duration ?? 0)}</div>

              {/* Format */}
              <div className="track-meta">
                {(song.suffix || song.bitRate) && <span className="track-codec">{codecLabel(song)}</span>}
              </div>

              {/* Delete */}
              <div className="playlist-row-delete-cell">
                <button
                  className="playlist-row-delete-btn"
                  onClick={e => { e.stopPropagation(); removeSong(idx); }}
                  data-tooltip={t('playlists.removeSong')}
                  data-tooltip-pos="left"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {isDragging && dropTargetIdx?.idx === idx && !dropTargetIdx.before && (
              <div className="playlist-drop-indicator" />
            )}
          </React.Fragment>
        ))}

        {/* Total row */}
        {songs.length > 0 && (
          <div className="tracklist-total tracklist-va tracklist-playlist">
            <span className="tracklist-total-label">{t('albumDetail.trackTotal')}</span>
            <span className="tracklist-total-value">{formatDuration(songs.reduce((a, s) => a + (s.duration ?? 0), 0))}</span>
          </div>
        )}
      </div>

      {/* ── Suggestions ── */}
      <div className="playlist-suggestions tracklist">
        <div className="playlist-suggestions-header">
          <h2 className="section-title" style={{ marginBottom: 0 }}>{t('playlists.suggestions')}</h2>
          <button
            className="btn btn-surface"
            onClick={() => loadSuggestions(songs)}
            disabled={loadingSuggestions || songs.length === 0}
            data-tooltip={t('playlists.refreshSuggestions')}
          >
            <RefreshCw size={14} className={loadingSuggestions ? 'spin-slow' : ''} />
            {t('playlists.refreshSuggestions')}
          </button>
        </div>

        {!loadingSuggestions && suggestions.filter(s => !existingIds.has(s.id)).length === 0 && (
          <div className="empty-state" style={{ padding: '1.5rem 0', fontSize: '0.85rem' }}>{t('playlists.noSuggestions')}</div>
        )}

        {suggestions.filter(s => !existingIds.has(s.id)).length > 0 && (
          <>
            <div className="tracklist-header tracklist-va tracklist-playlist" style={{ marginTop: 'var(--space-3)' }}>
              <div className="col-center">#</div>
              <div>{t('albumDetail.trackTitle')}</div>
              <div>{t('albumDetail.trackArtist')}</div>
              <div />
              <div />
              <div className="col-center">{t('albumDetail.trackDuration')}</div>
              <div>{t('albumDetail.trackFormat')}</div>
              <div />
            </div>

            {suggestions.filter(s => !existingIds.has(s.id)).map((song, idx) => (
              <div
                key={song.id}
                className={`track-row track-row-va tracklist-playlist${contextMenuSongId === song.id ? ' context-active' : ''}`}
                onMouseEnter={() => setHoveredSuggestionId(song.id)}
                onMouseLeave={() => setHoveredSuggestionId(null)}
                onClick={e => {
                  if ((e.target as HTMLElement).closest('button, a, input')) return;
                  addSong(song);
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  setContextMenuSongId(song.id);
                  openContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
                }}
              >
                <div className="track-num" style={{ color: 'var(--text-muted)' }}>
                  {idx + 1}
                </div>
                <div className="track-info">
                  <span className="track-title">{song.title}</span>
                </div>
                <div className="track-artist-cell">
                  <span
                    className={`track-artist${song.artistId ? ' track-artist-link' : ''}`}
                    style={{ cursor: song.artistId ? 'pointer' : 'default' }}
                    onClick={e => { if (song.artistId) { e.stopPropagation(); navigate(`/artist/${song.artistId}`); } }}
                  >{song.artist}</span>
                </div>
                {/* no star/rating for suggestions */}
                <div />
                <div />
                <div className="track-duration">{formatDuration(song.duration ?? 0)}</div>
                <div className="track-meta">
                  {(song.suffix || song.bitRate) && <span className="track-codec">{codecLabel(song)}</span>}
                </div>
                <div className="playlist-row-delete-cell">
                  <button
                    className="playlist-row-delete-btn"
                    style={{ color: hoveredSuggestionId === song.id ? 'var(--accent)' : undefined }}
                    onClick={e => { e.stopPropagation(); addSong(song); }}
                    data-tooltip={t('playlists.addSong')}
                    data-tooltip-pos="left"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
