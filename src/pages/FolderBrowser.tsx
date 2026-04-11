import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  getMusicFolders,
  getMusicDirectory,
  getMusicIndexes,
  SubsonicDirectoryEntry,
  SubsonicArtist,
  SubsonicAlbum,
} from '../api/subsonic';
import { usePlayerStore, Track } from '../store/playerStore';
import { useTranslation } from 'react-i18next';
import { Folder, FolderOpen, Music, ChevronRight } from 'lucide-react';

type ColumnKind = 'roots' | 'indexes' | 'directory';
type NavPos = { colIndex: number; rowIndex: number };
let persistedPlayingPathIds: string[] = [];

type Column = {
  id: string;
  name: string;
  items: SubsonicDirectoryEntry[];
  selectedId: string | null;
  loading: boolean;
  error: boolean;
  kind: ColumnKind;
};

/** getMusicDirectory: `albumId` or `album` + row `id` (Navidrome). */
function entryToAlbumIfPresent(item: SubsonicDirectoryEntry): SubsonicAlbum | null {
  if (!item.isDir) return null;
  const albumId = item.albumId ?? (item.album ? item.id : undefined);
  if (!albumId) return null;
  return {
    id: albumId,
    name: item.album ?? item.title,
    artist: item.artist ?? '',
    artistId: item.artistId ?? '',
    coverArt: item.coverArt,
    year: item.year,
    genre: item.genre,
    starred: item.starred,
    userRating: item.userRating,
    songCount: 0,
    duration: 0,
  };
}

function entryToTrack(e: SubsonicDirectoryEntry): Track {
  return {
    id: e.id,
    title: e.title,
    artist: e.artist ?? '',
    album: e.album ?? '',
    albumId: e.albumId ?? '',
    artistId: e.artistId,
    coverArt: e.coverArt,
    duration: e.duration ?? 0,
    track: e.track,
    year: e.year,
    bitRate: e.bitRate,
    suffix: e.suffix,
    genre: e.genre,
    starred: e.starred,
    userRating: e.userRating,
  };
}

export default function FolderBrowser() {
  const { t } = useTranslation();
  const [columns, setColumns] = useState<Column[]>([]);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [playingPathIds, setPlayingPathIds] = useState<string[]>(persistedPlayingPathIds);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingNavColRef = useRef<number | null>(null);
  const autoResolvedTrackRef = useRef<string | null>(null);
  const [keyboardPos, setKeyboardPos] = useState<NavPos | null>(null);
  const [contextAnchorPos, setContextAnchorPos] = useState<NavPos | null>(null);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const playTrack = usePlayerStore(s => s.playTrack);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const isContextMenuOpen = usePlayerStore(s => s.contextMenu.isOpen);

  useEffect(() => {
    const placeholder: Column = {
      id: 'root',
      name: '',
      items: [],
      selectedId: null,
      loading: true,
      error: false,
      kind: 'roots',
    };
    setColumns([placeholder]);
    getMusicFolders()
      .then(folders => {
        const items: SubsonicDirectoryEntry[] = folders.map(f => ({
          id: f.id,
          title: f.name,
          isDir: true,
        }));
        setColumns([{ ...placeholder, items, loading: false }]);
      })
      .catch(() => {
        setColumns([{ ...placeholder, items: [], loading: false, error: true }]);
      });
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [columns.length]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    requestAnimationFrame(() => {
      columns.forEach((col, colIndex) => {
        const selectedId = col.selectedId;
        if (!selectedId) return;
        const row = wrapperRef.current?.querySelector<HTMLElement>(
          `.folder-col[data-folder-col-index="${colIndex}"] .folder-col-row[data-item-id="${selectedId}"]`,
        );
        row?.scrollIntoView({ block: 'nearest' });
      });

      if (keyboardPos) {
        const kbdRow = wrapperRef.current?.querySelector<HTMLElement>(
          `.folder-col[data-folder-col-index="${keyboardPos.colIndex}"] .folder-col-row[data-row-index="${keyboardPos.rowIndex}"]`,
        );
        kbdRow?.scrollIntoView({ block: 'nearest' });
      }
    });
  }, [columns, keyboardPos]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const hasRows = columns.some(c => !c.loading && !c.error && c.items.length > 0);
    if (!hasRows) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
    });
  }, [columns]);

  useEffect(() => {
    if (!keyboardNavActive) return;
    const onMouseMove = () => setKeyboardNavActive(false);
    window.addEventListener('mousemove', onMouseMove, { once: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [keyboardNavActive]);

  useEffect(() => {
    if (!isContextMenuOpen) setContextAnchorPos(null);
  }, [isContextMenuOpen]);

  useEffect(() => {
    if (!currentTrack?.id) {
      setPlayingPathIds([]);
      return;
    }
    setPlayingPathIds(prev => (prev[prev.length - 1] === currentTrack.id ? prev : []));
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!isPlaying || !currentTrack?.id) return;
    const selectedChain = columns
      .map(c => c.selectedId)
      .filter((id): id is string => !!id);
    if (selectedChain.length === 0) return;

    const lastSelectedId = selectedChain[selectedChain.length - 1];
    const leafColumn = [...columns].reverse().find(c => c.selectedId);
    const leafItem = leafColumn?.items.find(it => it.id === lastSelectedId);
    if (!leafItem || leafItem.isDir || leafItem.id !== currentTrack.id) return;

    setPlayingPathIds(prev => {
      if (
        prev.length === selectedChain.length &&
        prev.every((id, idx) => id === selectedChain[idx])
      ) {
        return prev;
      }
      return selectedChain;
    });
  }, [columns, currentTrack?.id, isPlaying]);

  useEffect(() => {
    persistedPlayingPathIds = playingPathIds;
  }, [playingPathIds]);

  const preferredRowIndex = useCallback((col: Column): number => {
    if (col.items.length === 0) return -1;
    if (col.selectedId) {
      const selectedIdx = col.items.findIndex(it => it.id === col.selectedId);
      if (selectedIdx >= 0) return selectedIdx;
    }
    return 0;
  }, []);

  const fallbackNavPos = useCallback((cols: Column[]): NavPos | null => {
    for (let c = 0; c < cols.length; c++) {
      const rowIndex = preferredRowIndex(cols[c]);
      if (rowIndex >= 0) return { colIndex: c, rowIndex };
    }
    return null;
  }, [preferredRowIndex]);

  useEffect(() => {
    if (pendingNavColRef.current !== null) {
      const targetColIndex = pendingNavColRef.current;
      const targetCol = columns[targetColIndex];
      if (targetCol && targetCol.items.length > 0 && !targetCol.loading && !targetCol.error) {
        const rowIndex = preferredRowIndex(targetCol);
        const targetItem = targetCol.items[rowIndex];
        setColumns(prev =>
          prev.map((c, i) => (i === targetColIndex ? { ...c, selectedId: targetItem.id } : c)),
        );
        setKeyboardPos({
          colIndex: targetColIndex,
          rowIndex,
        });
        pendingNavColRef.current = null;
        return;
      }
    }

    setKeyboardPos(prev => {
      if (!prev) return fallbackNavPos(columns);
      if (prev.colIndex >= columns.length) return fallbackNavPos(columns);
      const col = columns[prev.colIndex];
      if (col.loading || col.error || col.items.length === 0) return fallbackNavPos(columns);
      if (prev.rowIndex >= col.items.length) {
        return { colIndex: prev.colIndex, rowIndex: col.items.length - 1 };
      }
      return prev;
    });
  }, [columns, fallbackNavPos, preferredRowIndex]);

  const handleDirClick = useCallback((colIndex: number, item: SubsonicDirectoryEntry) => {
    const nextKind: ColumnKind = colIndex === 0 ? 'indexes' : 'directory';
    setColumns(prev => [
      ...prev.slice(0, colIndex + 1).map((c, i) =>
        i === colIndex ? { ...c, selectedId: item.id } : c,
      ),
      {
        id: item.id,
        name: item.title,
        items: [],
        selectedId: null,
        loading: true,
        error: false,
        kind: nextKind,
      },
    ]);

    const fetchItems =
      colIndex === 0 ? getMusicIndexes(item.id) : getMusicDirectory(item.id).then(d => d.child);

    fetchItems
      .then(items => {
        setColumns(prev => {
          const idx = prev.findIndex(c => c.id === item.id && c.loading);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], items, loading: false };
          return next;
        });
      })
      .catch(() => {
        setColumns(prev => {
          const idx = prev.findIndex(c => c.id === item.id && c.loading);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], loading: false, error: true };
          return next;
        });
      });
  }, []);

  const handleFileClick = useCallback(
    (colIndex: number, item: SubsonicDirectoryEntry) => {
      setColumns(prev =>
        prev.map((c, i) => (i === colIndex ? { ...c, selectedId: item.id } : c)),
      );
      const path = [
        ...columns.slice(0, colIndex).map(c => c.selectedId).filter((id): id is string => !!id),
        item.id,
      ];
      setPlayingPathIds(path);
      const col = columns[colIndex];
      const queue = col.items.filter(it => !it.isDir).map(entryToTrack);
      playTrack(entryToTrack(item), queue.length > 0 ? queue : [entryToTrack(item)]);
    },
    [columns, playTrack],
  );

  const setSelectedInColumn = useCallback((colIndex: number, itemId: string) => {
    setColumns(prev =>
      prev.map((c, i) => (i === colIndex ? { ...c, selectedId: itemId } : c)),
    );
  }, []);

  const clearSelectedInColumn = useCallback((colIndex: number) => {
    setColumns(prev =>
      prev.map((c, i) => (i === colIndex ? { ...c, selectedId: null } : c)),
    );
  }, []);

  const handleActivate = useCallback((colIndex: number, item: SubsonicDirectoryEntry) => {
    if (item.isDir) {
      handleDirClick(colIndex, item);
      pendingNavColRef.current = colIndex + 1;
      return;
    }
    handleFileClick(colIndex, item);
  }, [handleDirClick, handleFileClick]);

  const openContextMenuForEntry = useCallback(
    (col: Column, item: SubsonicDirectoryEntry, x: number, y: number) => {
      if (item.isDir) {
        if (col.kind === 'indexes') {
          const artist: SubsonicArtist = { id: item.id, name: item.title, coverArt: item.coverArt };
          openContextMenu(x, y, artist, 'artist');
          return;
        }
        const album = entryToAlbumIfPresent(item);
        if (album) {
          openContextMenu(x, y, album, 'album');
          return;
        }
        if (item.artistId) {
          const artist: SubsonicArtist = {
            id: item.artistId,
            name: item.artist ?? item.title,
            coverArt: item.coverArt,
          };
          openContextMenu(x, y, artist, 'artist');
          return;
        }
        return;
      }
      openContextMenu(x, y, entryToTrack(item), 'song');
    },
    [openContextMenu],
  );

  const onColumnsKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isContextMenuOpen) return;
    const key = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return;
    setKeyboardNavActive(true);
    const current = keyboardPos ?? fallbackNavPos(columns);
    if (!current) return;

    const col = columns[current.colIndex];
    const item = col?.items[current.rowIndex];
    if (!col || !item) return;

    e.preventDefault();

    if (key === 'Enter' && e.ctrlKey) {
      setContextAnchorPos(current);
      const rowEl = wrapperRef.current?.querySelector<HTMLElement>(
        `.folder-col-row[data-col-index="${current.colIndex}"][data-row-index="${current.rowIndex}"]`,
      );
      const rect = rowEl?.getBoundingClientRect();
      const x = rect ? rect.left + 24 : 24;
      const y = rect ? rect.top + rect.height / 2 : 24;
      openContextMenuForEntry(col, item, x, y);
      return;
    }

    if (key === 'ArrowUp') {
      if (current.rowIndex > 0) {
        const nextRowIndex = current.rowIndex - 1;
        const nextItem = col.items[nextRowIndex];
        setKeyboardPos({ colIndex: current.colIndex, rowIndex: nextRowIndex });
        if (nextItem.isDir) handleDirClick(current.colIndex, nextItem);
        else setSelectedInColumn(current.colIndex, nextItem.id);
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (current.rowIndex < col.items.length - 1) {
        const nextRowIndex = current.rowIndex + 1;
        const nextItem = col.items[nextRowIndex];
        setKeyboardPos({ colIndex: current.colIndex, rowIndex: nextRowIndex });
        if (nextItem.isDir) handleDirClick(current.colIndex, nextItem);
        else setSelectedInColumn(current.colIndex, nextItem.id);
      }
      return;
    }
    if (key === 'ArrowLeft') {
      if (current.colIndex > 0) {
        clearSelectedInColumn(current.colIndex);
        const nextColIndex = current.colIndex - 1;
        const rowIndex = preferredRowIndex(columns[nextColIndex]);
        if (rowIndex >= 0) setKeyboardPos({ colIndex: nextColIndex, rowIndex });
      }
      return;
    }
    if (key === 'ArrowRight') {
      const nextColIndex = current.colIndex + 1;
      if (nextColIndex < columns.length) {
        const rowIndex = preferredRowIndex(columns[nextColIndex]);
        if (rowIndex >= 0) {
          const nextItem = columns[nextColIndex].items[rowIndex];
          setSelectedInColumn(nextColIndex, nextItem.id);
          setKeyboardPos({ colIndex: nextColIndex, rowIndex });
          return;
        }
      }
      if (item.isDir) handleActivate(current.colIndex, item);
      return;
    }
    if (key === 'Enter') {
      handleActivate(current.colIndex, item);
    }
  }, [keyboardPos, fallbackNavPos, columns, preferredRowIndex, handleActivate, handleDirClick, setSelectedInColumn, clearSelectedInColumn, openContextMenuForEntry, isContextMenuOpen]);

  const onRowContextMenu = useCallback(
    (e: React.MouseEvent, colIndex: number, rowIndex: number, col: Column, item: SubsonicDirectoryEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setContextAnchorPos({ colIndex, rowIndex });
      openContextMenuForEntry(col, item, e.clientX, e.clientY);
    },
    [openContextMenuForEntry],
  );

  const resolveColumnsForTrack = useCallback(async (
    track: Track,
    roots: SubsonicDirectoryEntry[],
  ): Promise<Column[] | null> => {
    for (const root of roots) {
      let indexes: SubsonicDirectoryEntry[];
      try {
        indexes = await getMusicIndexes(root.id);
      } catch {
        continue;
      }

      const artistEntry =
        indexes.find(it => it.isDir && !!track.artistId && it.id === track.artistId) ??
        indexes.find(it => it.isDir && it.title === track.artist);
      if (!artistEntry) continue;

      let artistChildren: SubsonicDirectoryEntry[];
      try {
        artistChildren = (await getMusicDirectory(artistEntry.id)).child;
      } catch {
        continue;
      }

      const albumEntry = artistChildren.find(it =>
        it.isDir &&
        (
          (!!track.albumId && (it.albumId === track.albumId || it.id === track.albumId)) ||
          (!!track.album && (it.album === track.album || it.title === track.album))
        ),
      );
      if (!albumEntry) continue;

      let albumChildren: SubsonicDirectoryEntry[];
      try {
        albumChildren = (await getMusicDirectory(albumEntry.id)).child;
      } catch {
        continue;
      }
      const songEntry = albumChildren.find(it => !it.isDir && it.id === track.id);
      if (!songEntry) continue;

      return [
        { id: 'root', name: '', items: roots, selectedId: root.id, loading: false, error: false, kind: 'roots' },
        { id: root.id, name: root.title, items: indexes, selectedId: artistEntry.id, loading: false, error: false, kind: 'indexes' },
        { id: artistEntry.id, name: artistEntry.title, items: artistChildren, selectedId: albumEntry.id, loading: false, error: false, kind: 'directory' },
        { id: albumEntry.id, name: albumEntry.title, items: albumChildren, selectedId: songEntry.id, loading: false, error: false, kind: 'directory' },
      ];
    }
    return null;
  }, []);

  const isSelectedPathForCurrentTrack =
    isPlaying && currentTrack && playingPathIds[playingPathIds.length - 1] === currentTrack.id;

  useEffect(() => {
    if (!currentTrack?.id) {
      autoResolvedTrackRef.current = null;
      return;
    }
    if (autoResolvedTrackRef.current === currentTrack.id) return;

    const rootCol = columns[0];
    if (!rootCol || rootCol.loading || rootCol.error || rootCol.items.length === 0) return;

    const selectedLeafId =
      [...columns].reverse().find(c => c.selectedId)?.selectedId ?? null;
    if (selectedLeafId === currentTrack.id) {
      autoResolvedTrackRef.current = currentTrack.id;
      return;
    }

    let cancelled = false;
    resolveColumnsForTrack(currentTrack, rootCol.items).then((resolved) => {
      if (cancelled || !resolved) return;
      setColumns(resolved);
      const path = resolved.map(c => c.selectedId).filter((id): id is string => !!id);
      setPlayingPathIds(path);
      const leafColIndex = resolved.length - 1;
      const leafRowIndex = resolved[leafColIndex].items.findIndex(it => it.id === currentTrack.id);
      if (leafRowIndex >= 0) setKeyboardPos({ colIndex: leafColIndex, rowIndex: leafRowIndex });
      autoResolvedTrackRef.current = currentTrack.id;
    });

    return () => { cancelled = true; };
  }, [columns, currentTrack, resolveColumnsForTrack]);

  return (
    <div className="folder-browser">
      <h1 className="page-title folder-browser-title">{t('sidebar.folderBrowser')}</h1>
      <div
        className={`folder-browser-columns${keyboardNavActive ? ' keyboard-nav-active' : ''}`}
        ref={wrapperRef}
        tabIndex={0}
        onKeyDown={onColumnsKeyDown}
      >
        {columns.map((col, colIndex) => (
          <div key={`${col.id}-${colIndex}`} className="folder-col" data-folder-col-index={colIndex}>
            {col.loading ? (
              <div className="folder-col-status">
                <div className="spinner" style={{ width: 20, height: 20 }} />
              </div>
            ) : col.error ? (
              <div className="folder-col-status folder-col-error">
                {t('folderBrowser.error')}
              </div>
            ) : col.items.length === 0 ? (
              <div className="folder-col-status">{t('folderBrowser.empty')}</div>
            ) : (
              col.items.map(item => {
                const isSelected = col.selectedId === item.id;
                const rowIndex = col.items.findIndex(it => it.id === item.id);
                const isContextRow =
                  contextAnchorPos?.colIndex === colIndex && contextAnchorPos.rowIndex === rowIndex;
                const isKeyboardRow =
                  keyboardPos?.colIndex === colIndex && keyboardPos?.rowIndex === rowIndex;
                const isNowPlayingTrack = !item.isDir && currentTrack?.id === item.id;
                const isPathPlayingIcon = !!(isSelectedPathForCurrentTrack && playingPathIds.includes(item.id));
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-col-index={colIndex}
                    data-row-index={rowIndex}
                    data-item-id={item.id}
                    className={`folder-col-row${isSelected ? ' selected' : ''}${isContextRow ? ' context-active' : ''}${isKeyboardRow ? ' keyboard-active' : ''}${isNowPlayingTrack ? ' now-playing' : ''}`}
                    onClick={() => {
                      setKeyboardPos({ colIndex, rowIndex });
                      if (item.isDir) handleDirClick(colIndex, item);
                      else handleFileClick(colIndex, item);
                    }}
                    onContextMenu={e => {
                      setKeyboardPos({ colIndex, rowIndex });
                      onRowContextMenu(e, colIndex, rowIndex, col, item);
                    }}
                  >
                    <span className={`folder-col-icon${isPathPlayingIcon ? ' folder-col-path-playing-icon' : ''}`}>
                      {item.isDir ? (
                        isSelected ? (
                          <FolderOpen size={14} />
                        ) : (
                          <Folder size={14} />
                        )
                      ) : (
                        <Music size={14} strokeWidth={isNowPlayingTrack ? 2.5 : 2} className={isNowPlayingTrack && isPlaying ? 'folder-col-playing-icon' : undefined} />
                      )}
                    </span>
                    <span className="folder-col-name">{item.title}</span>
                    {item.isDir && <ChevronRight size={12} className="folder-col-chevron" />}
                  </button>
                );
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
