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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playTrack = usePlayerStore(s => s.playTrack);
  const openContextMenu = usePlayerStore(s => s.openContextMenu);

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
      const col = columns[colIndex];
      const queue = col.items.filter(it => !it.isDir).map(entryToTrack);
      playTrack(entryToTrack(item), queue.length > 0 ? queue : [entryToTrack(item)]);
    },
    [columns, playTrack],
  );

  const onRowContextMenu = useCallback(
    (e: React.MouseEvent, col: Column, item: SubsonicDirectoryEntry) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.isDir) {
        if (col.kind === 'indexes') {
          const artist: SubsonicArtist = { id: item.id, name: item.title, coverArt: item.coverArt };
          openContextMenu(e.clientX, e.clientY, artist, 'artist');
          return;
        }
        const album = entryToAlbumIfPresent(item);
        if (album) {
          openContextMenu(e.clientX, e.clientY, album, 'album');
          return;
        }
        if (item.artistId) {
          const artist: SubsonicArtist = {
            id: item.artistId,
            name: item.artist ?? item.title,
            coverArt: item.coverArt,
          };
          openContextMenu(e.clientX, e.clientY, artist, 'artist');
          return;
        }
        return;
      }
      openContextMenu(e.clientX, e.clientY, entryToTrack(item), 'song');
    },
    [openContextMenu],
  );

  return (
    <div className="folder-browser">
      <h1 className="page-title folder-browser-title">{t('sidebar.folderBrowser')}</h1>
      <div className="folder-browser-columns" ref={wrapperRef}>
        {columns.map((col, colIndex) => (
          <div key={`${col.id}-${colIndex}`} className="folder-col">
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
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`folder-col-row${isSelected ? ' selected' : ''}`}
                    onClick={() =>
                      item.isDir ? handleDirClick(colIndex, item) : handleFileClick(colIndex, item)
                    }
                    onContextMenu={e => onRowContextMenu(e, col, item)}
                  >
                    <span className="folder-col-icon">
                      {item.isDir ? (
                        isSelected ? (
                          <FolderOpen size={14} />
                        ) : (
                          <Folder size={14} />
                        )
                      ) : (
                        <Music size={14} />
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
