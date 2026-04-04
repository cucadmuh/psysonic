import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Play, Heart, ListPlus, X, ChevronDown, Check } from 'lucide-react';
import { SubsonicSong } from '../api/subsonic';
import { Track, usePlayerStore, songToTrack } from '../store/playerStore';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDragDrop } from '../contexts/DragDropContext';
import { AddToPlaylistSubmenu } from './ContextMenu';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function codecLabel(song: { suffix?: string; bitRate?: number }): string {
  const parts: string[] = [];
  if (song.suffix) parts.push(song.suffix.toUpperCase());
  if (song.bitRate) parts.push(`${song.bitRate}`);
  return parts.join(' ');
}

function StarRating({ value, onChange }: { value: number; onChange: (r: number) => void }) {
  const { t } = useTranslation();
  const [hover, setHover] = React.useState(0);
  return (
    <div className="star-rating" role="radiogroup" aria-label={t('albumDetail.ratingLabel')}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`star ${(hover || value) >= n ? 'filled' : ''}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          aria-label={`${n}`}
          role="radio"
          aria-checked={(hover || value) >= n}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Column configuration ──────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'num',      i18nKey: null,             minWidth: 60,  defaultWidth: 60,   required: true,  fixed: true  },
  { key: 'title',    i18nKey: 'trackTitle',     minWidth: 100, defaultWidth: 220,  required: true,  fixed: false },
  { key: 'artist',   i18nKey: 'trackArtist',    minWidth: 80,  defaultWidth: 160,  required: false, fixed: false },
  { key: 'favorite', i18nKey: 'trackFavorite',  minWidth: 50,  defaultWidth: 70,   required: false, fixed: false },
  { key: 'rating',   i18nKey: 'trackRating',    minWidth: 80,  defaultWidth: 100,  required: false, fixed: false },
  { key: 'duration', i18nKey: 'trackDuration',  minWidth: 50,  defaultWidth: 60,   required: false, fixed: false },
  { key: 'format',   i18nKey: 'trackFormat',    minWidth: 60,  defaultWidth: 80,   required: false, fixed: false },
  { key: 'genre',    i18nKey: 'trackGenre',     minWidth: 60,  defaultWidth: 80,   required: false, fixed: false },
] as const;

type ColKey = (typeof COLUMNS)[number]['key'];

const DEFAULT_WIDTHS: Record<ColKey, number> = Object.fromEntries(
  COLUMNS.map(c => [c.key, c.defaultWidth])
) as Record<ColKey, number>;

const DEFAULT_VISIBLE = new Set<ColKey>([
  'num', 'title', 'artist', 'favorite', 'rating', 'duration', 'format', 'genre',
]);

function loadColPrefs(): { widths: Record<ColKey, number>; visible: Set<ColKey> } {
  try {
    const raw = localStorage.getItem('psysonic_tracklist_columns');
    if (!raw) return { widths: { ...DEFAULT_WIDTHS }, visible: new Set(DEFAULT_VISIBLE) };
    const parsed = JSON.parse(raw);
    const visible = new Set<ColKey>((parsed.visible as ColKey[]) ?? [...DEFAULT_VISIBLE]);
    COLUMNS.filter(c => c.required).forEach(c => visible.add(c.key as ColKey));
    return {
      widths: { ...DEFAULT_WIDTHS, ...(parsed.widths ?? {}) },
      visible,
    };
  } catch {
    return { widths: { ...DEFAULT_WIDTHS }, visible: new Set(DEFAULT_VISIBLE) };
  }
}

function saveColPrefs(widths: Record<ColKey, number>, visible: Set<ColKey>) {
  localStorage.setItem('psysonic_tracklist_columns', JSON.stringify({
    widths,
    visible: [...visible],
  }));
}

/** Scale flexible (non-fixed) visible columns proportionally to fill `targetW` exactly.
 *  Fixed columns (e.g. 'num') keep their width unchanged.
 *  Each flexible column is clamped to its minWidth; rounding error is absorbed by 'title'. */
function fitColumnsToWidth(
  widths: Record<ColKey, number>,
  vCols: readonly { readonly key: string; readonly minWidth: number; readonly fixed: boolean }[],
  targetW: number,
  gapPx: number
): Record<ColKey, number> {
  if (vCols.length === 0 || targetW <= 0) return widths;
  const next = { ...widths };
  const fixedCols = vCols.filter(c => c.fixed);
  const flexCols  = vCols.filter(c => !c.fixed);
  if (flexCols.length === 0) return next;
  const totalGaps  = Math.max(0, vCols.length - 1) * gapPx;
  const fixedTotal = fixedCols.reduce((s, c) => s + (next[c.key as ColKey] ?? c.minWidth), 0);
  const available  = targetW - totalGaps - fixedTotal;
  if (available <= 0) return next;
  const currentFlexTotal = flexCols.reduce((s, c) => s + (next[c.key as ColKey] ?? c.minWidth), 0);
  if (currentFlexTotal === 0) return next;
  const ratio = available / currentFlexTotal;
  flexCols.forEach(c => {
    const key = c.key as ColKey;
    next[key] = Math.max(c.minWidth, Math.round((next[key] ?? c.minWidth) * ratio));
  });
  // Correct rounding drift in 'title' column
  const newFlexTotal = flexCols.reduce((s, c) => s + next[c.key as ColKey], 0);
  const diff = available - newFlexTotal;
  if (flexCols.some(c => c.key === 'title') && diff !== 0) {
    const titleDef = COLUMNS.find(c => c.key === 'title')!;
    next['title'] = Math.max(titleDef.minWidth, next['title'] + diff);
  }
  return next;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AlbumTrackListProps {
  songs: SubsonicSong[];
  hasVariousArtists: boolean;
  currentTrack: Track | null;
  isPlaying: boolean;
  ratings: Record<string, number>;
  starredSongs: Set<string>;
  onPlaySong: (song: SubsonicSong) => void;
  onRate: (songId: string, rating: number) => void;
  onToggleSongStar: (song: SubsonicSong, e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number, track: Track, type: 'song' | 'album' | 'artist' | 'queue-item' | 'album-song') => void;
}

export default function AlbumTrackList({
  songs,
  hasVariousArtists,
  currentTrack,
  isPlaying,
  ratings,
  starredSongs,
  onPlaySong,
  onRate,
  onToggleSongStar,
  onContextMenu,
}: AlbumTrackListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [contextMenuSongId, setContextMenuSongId] = useState<string | null>(null);
  const contextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);
  const psyDrag = useDragDrop();

  // ── Bulk select ───────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [showPlPicker, setShowPlPicker] = useState(false);

  // ── Column state ──────────────────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(() => loadColPrefs().widths);
  const [colVisible, setColVisible] = useState<Set<ColKey>>(() => loadColPrefs().visible);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tracklistRef = useRef<HTMLDivElement>(null);
  const prevContainerW = useRef(0);
  const colVisibleRef = useRef(colVisible);
  useEffect(() => { colVisibleRef.current = colVisible; }, [colVisible]);

  // Stores the user's last intentional column widths + the container W they match.
  // ResizeObserver always scales FROM this base — never from intermediate scaled values.
  // This prevents drift when the window is shrunk and enlarged again.
  const baseWidthsRef = useRef<{ widths: Record<ColKey, number>; containerW: number } | null>(null);
  // Tracks current colWidths without a useEffect dependency in callbacks
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // On mount: fit saved (or default) widths to current container; establish base.
  useLayoutEffect(() => {
    const el = tracklistRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const containerW = el.clientWidth - paddingH;
    prevContainerW.current = containerW;
    const vCols = COLUMNS.filter(c => colVisibleRef.current.has(c.key));
    setColWidths(prev => {
      const fitted = fitColumnsToWidth(prev, vCols, containerW, 12);
      baseWidthsRef.current = { widths: fitted, containerW };
      return fitted;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the container resizes, scale all columns proportionally FROM the base.
  // Using the base (not prev) means shrink → grow always returns to exact original widths.
  useEffect(() => {
    const el = tracklistRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const newW = el.clientWidth - paddingH;
      if (Math.abs(newW - prevContainerW.current) < 2) return;
      prevContainerW.current = newW;
      const base = baseWidthsRef.current;
      if (!base) return;
      const headerEl = el.querySelector('.tracklist-header') as HTMLElement | null;
      const gapPx = headerEl ? (parseFloat(getComputedStyle(headerEl).columnGap) || 12) : 12;
      const vCols = COLUMNS.filter(c => colVisibleRef.current.has(c.key));
      // Always scale from base.widths, never from current state → no drift
      setColWidths(() => fitColumnsToWidth(base.widths, vCols, newW, gapPx));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // All visible columns in order
  const visibleCols = useMemo(
    () => COLUMNS.filter(c => colVisible.has(c.key)),
    [colVisible]
  );

  // Grid template: all fixed px — bidirectional resize works correctly
  const gridTemplate = useMemo(
    () => visibleCols.map(c => `${colWidths[c.key]}px`).join(' '),
    [colWidths, visibleCols]
  );

  const colStyle = { gridTemplateColumns: gridTemplate };


  // ── Bidirectional resize ─────────────────────────────────────────────────
  // Dragging the divider between col[colIndex] and col[colIndex+1]:
  //   → right: colA grows, colB shrinks (clamped to minWidth)
  //   → left:  colA shrinks, colB grows (clamped to minWidth)
  // Excel-style resize: only the dragged column changes width.
  // Clamped so total never exceeds container width — no overflow, no scrollbar.
  const startResize = (e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const colA = visibleCols[colIndex];
    const defA = COLUMNS.find(c => c.key === colA.key)!;
    const startX = e.clientX;
    const startW = colWidths[colA.key as ColKey];
    const snapshotVisible = colVisible;

    // Measure container once at drag start
    let maxW = Infinity;
    const el = tracklistRef.current;
    if (el) {
      const style = getComputedStyle(el);
      const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const containerW = el.clientWidth - paddingH;
      const headerEl = el.querySelector('.tracklist-header') as HTMLElement | null;
      const gapPx = headerEl ? (parseFloat(getComputedStyle(headerEl).columnGap) || 0) : 12;
      const sumOthers = visibleCols
        .filter((_, i) => i !== colIndex)
        .reduce((s, c) => s + colWidths[c.key as ColKey], 0);
      maxW = Math.max(defA.minWidth, containerW - sumOthers - (visibleCols.length - 1) * gapPx);
    }

    const onMove = (me: MouseEvent) => {
      const newW = Math.min(Math.max(defA.minWidth, startW + me.clientX - startX), maxW);
      setColWidths(prev => ({ ...prev, [colA.key]: newW }));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Save final state and update base so future window resizes scale from here
      const finalWidths = colWidthsRef.current;
      baseWidthsRef.current = { widths: { ...finalWidths }, containerW: prevContainerW.current };
      saveColPrefs(finalWidths, snapshotVisible);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const toggleColumn = (key: ColKey) => {
    const def = COLUMNS.find(c => c.key === key)!;
    if (def.required) return;
    setColVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveColPrefs(colWidths, next);
      return next;
    });
  };

  const toggleSelect = (id: string, globalIdx: number, shift: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shift && lastSelectedIdx !== null) {
        const from = Math.min(lastSelectedIdx, globalIdx);
        const to = Math.max(lastSelectedIdx, globalIdx);
        songs.slice(from, to + 1).forEach(s => next.add(s.id));
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastSelectedIdx(globalIdx);
  };

  const allSelected = selectedIds.size === songs.length && songs.length > 0;
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(songs.map(s => s.id)));

  useEffect(() => {
    if (!contextMenuOpen) setContextMenuSongId(null);
  }, [contextMenuOpen]);

  useEffect(() => {
    if (!showPlPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.bulk-pl-picker-wrap')) setShowPlPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPlPicker]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const totalDuration = songs.reduce((acc, s) => acc + s.duration, 0);

  const discs = new Map<number, SubsonicSong[]>();
  songs.forEach(song => {
    const disc = song.discNumber ?? 1;
    if (!discs.has(disc)) discs.set(disc, []);
    discs.get(disc)!.push(song);
  });
  const discNums = Array.from(discs.keys()).sort((a, b) => a - b);
  const isMultiDisc = discNums.length > 1;

  const inSelectMode = selectedIds.size > 0;

  // ── Header cell renderer ──────────────────────────────────────────────────
  const renderHeaderCell = (colDef: (typeof COLUMNS)[number], colIndex: number) => {
    const key = colDef.key as ColKey;
    const isLastCol = colIndex === visibleCols.length - 1;
    const isCentered = key === 'favorite' || key === 'rating' || key === 'duration';
    const label = colDef.i18nKey ? t(`albumDetail.${colDef.i18nKey as string}`) : '';

    // 'num' header mirrors the row-cell layout exactly so checkbox + # stay aligned
    if (key === 'num') {
      return (
        <div key={key} className="track-num">
          <span
            className={`bulk-check${allSelected ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
            onClick={e => { e.stopPropagation(); toggleAll(); }}
            style={{ cursor: 'pointer' }}
          />
          <span className="track-num-number">#</span>
        </div>
      );
    }

    return (
      <div
        key={key}
        className={isCentered ? 'col-center' : undefined}
        style={{ position: 'relative' }}
      >
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {/* Resize handle on all non-fixed columns except the last */}
        {!isLastCol && !colDef.fixed && (
          <div
            className="col-resize-handle"
            onMouseDown={e => startResize(e, colIndex)}
          />
        )}
      </div>
    );
  };

  // ── Row cell renderer ─────────────────────────────────────────────────────
  const renderRowCell = (key: ColKey, song: SubsonicSong, globalIdx: number) => {
    switch (key) {
      case 'num':
        return (
          <div
            key="num"
            className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}${currentTrack?.id === song.id && !isPlaying ? ' track-num-paused' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onPlaySong(song); }}
          >
            <span
              className={`bulk-check${selectedIds.has(song.id) ? ' checked' : ''}${inSelectMode ? ' bulk-check-visible' : ''}`}
              onClick={e => { e.stopPropagation(); toggleSelect(song.id, globalIdx, e.shiftKey); }}
            />
            {currentTrack?.id === song.id && isPlaying && (
              <span className="track-num-eq">
                <div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div>
              </span>
            )}
            <span className="track-num-play"><Play size={13} fill="currentColor" /></span>
            <span className="track-num-number">{song.track ?? '—'}</span>
          </div>
        );
      case 'title':
        return (
          <div key="title" className="track-info">
            <span className="track-title">{song.title}</span>
          </div>
        );
      case 'artist':
        return (
          <div key="artist" className="track-artist-cell">
            <span
              className={`track-artist${song.artistId ? ' track-artist-link' : ''}`}
              style={{ cursor: song.artistId ? 'pointer' : 'default' }}
              onClick={e => { if (song.artistId) { e.stopPropagation(); navigate(`/artist/${song.artistId}`); } }}
            >
              {song.artist}
            </span>
          </div>
        );
      case 'favorite':
        return (
          <div key="favorite" className="track-star-cell">
            <button
              className="btn btn-ghost track-star-btn"
              onClick={e => onToggleSongStar(song, e)}
              data-tooltip={starredSongs.has(song.id) ? t('albumDetail.favoriteRemove') : t('albumDetail.favoriteAdd')}
              style={{ color: starredSongs.has(song.id) ? 'var(--color-star-active, var(--accent))' : 'var(--color-star-inactive, var(--text-muted))' }}
            >
              <Heart size={14} fill={starredSongs.has(song.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        );
      case 'rating':
        return (
          <StarRating
            key="rating"
            value={ratings[song.id] ?? song.userRating ?? 0}
            onChange={r => onRate(song.id, r)}
          />
        );
      case 'duration':
        return (
          <div key="duration" className="track-duration">
            {formatDuration(song.duration)}
          </div>
        );
      case 'format':
        return (
          <div key="format" className="track-meta">
            {(song.suffix || song.bitRate) && (
              <span className="track-codec">{codecLabel(song)}</span>
            )}
          </div>
        );
      case 'genre':
        return (
          <div key="genre" className="track-genre">
            {song.genre ?? '—'}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="tracklist" ref={tracklistRef}>

      {/* ── Bulk action bar ── */}
      {inSelectMode && (
        <div className="bulk-action-bar">
          <span className="bulk-action-count">
            {t('common.bulkSelected', { count: selectedIds.size })}
          </span>
          <div className="bulk-pl-picker-wrap">
            <button
              className="btn btn-surface btn-sm"
              onClick={() => setShowPlPicker(v => !v)}
            >
              <ListPlus size={14} />
              {t('common.bulkAddToPlaylist')}
            </button>
            {showPlPicker && (
              <AddToPlaylistSubmenu
                songIds={[...selectedIds]}
                onDone={() => { setShowPlPicker(false); setSelectedIds(new Set()); }}
                dropDown
              />
            )}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSelectedIds(new Set())}
          >
            <X size={13} />
            {t('common.bulkClear')}
          </button>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ position: 'relative' }}>
        <div className="tracklist-header" style={colStyle}>
          {visibleCols.map((colDef, colIndex) => renderHeaderCell(colDef, colIndex))}
        </div>

        {/* Column visibility picker */}
        <div className="tracklist-col-picker" ref={pickerRef}>
          <button
            className="tracklist-col-picker-btn"
            onClick={e => { e.stopPropagation(); setPickerOpen(v => !v); }}
            data-tooltip={t('albumDetail.columns')}
          >
            <ChevronDown size={14} />
          </button>
          {pickerOpen && (
            <div className="tracklist-col-picker-menu">
              <div className="tracklist-col-picker-label">{t('albumDetail.columns')}</div>
              {COLUMNS.filter(c => !c.required).map(c => {
                const key = c.key as ColKey;
                const label = c.i18nKey ? t(`albumDetail.${c.i18nKey as string}`) : key;
                const isOn = colVisible.has(key);
                return (
                  <button
                    key={key}
                    className={`tracklist-col-picker-item${isOn ? ' active' : ''}`}
                    onClick={() => toggleColumn(key)}
                  >
                    <span className="tracklist-col-picker-check">
                      {isOn && <Check size={13} />}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Tracks ── */}
      {discNums.map(discNum => (
        <div key={discNum}>
          {isMultiDisc && (
            <div className="disc-header">
              <span className="disc-icon">💿</span>
              CD {discNum}
            </div>
          )}
          {discs.get(discNum)!.map((song) => {
            const globalIdx = songs.indexOf(song);
            return (
              <div
                key={song.id}
                className={`track-row track-row-va${currentTrack?.id === song.id ? ' active' : ''}${contextMenuSongId === song.id ? ' context-active' : ''}${selectedIds.has(song.id) ? ' bulk-selected' : ''}`}
                style={colStyle}
                onClick={e => {
                  if ((e.target as HTMLElement).closest('button, a, input')) return;
                  if (inSelectMode) {
                    toggleSelect(song.id, globalIdx, e.shiftKey);
                  } else {
                    onPlaySong(song);
                  }
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  setContextMenuSongId(song.id);
                  onContextMenu(e.clientX, e.clientY, songToTrack(song), 'album-song');
                }}
                role="row"
                onMouseDown={e => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  const sx = e.clientX, sy = e.clientY;
                  const onMove = (me: MouseEvent) => {
                    if (Math.abs(me.clientX - sx) > 5 || Math.abs(me.clientY - sy) > 5) {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                      psyDrag.startDrag({ data: JSON.stringify({ type: 'song', track: songToTrack(song) }), label: song.title }, me.clientX, me.clientY);
                    }
                  };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              >
                {visibleCols.map(colDef => renderRowCell(colDef.key as ColKey, song, globalIdx))}
              </div>
            );
          })}
        </div>
      ))}

    </div>
  );
}
