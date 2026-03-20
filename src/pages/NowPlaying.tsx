import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Play, Shuffle, Star, Music, Save, FolderOpen, Trash2, X,
} from 'lucide-react';
import { usePlayerStore, Track } from '../store/playerStore';
import {
  buildCoverArtUrl, coverArtCacheKey, getSong, star, unstar,
  getPlaylists, getPlaylist, createPlaylist, deletePlaylist,
  getAlbum, SubsonicPlaylist, SubsonicSong,
} from '../api/subsonic';
import { useCachedUrl } from '../components/CachedImage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function renderStars(rating?: number) {
  if (!rating) return null;
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={14}
          fill={i <= rating ? 'var(--ctp-yellow)' : 'none'}
          color={i <= rating ? 'var(--ctp-yellow)' : 'var(--text-muted)'}
        />
      ))}
    </div>
  );
}

// ─── Blurred background (crossfade on track change) ───────────────────────────

const NpBg = memo(function NpBg({ url }: { url: string }) {
  const [layers, setLayers] = useState<Array<{ url: string; id: number; visible: boolean }>>(() =>
    url ? [{ url, id: 0, visible: true }] : []
  );
  const nextId = useRef(1);

  useEffect(() => {
    if (!url) return;
    const id = nextId.current++;
    setLayers(prev => [...prev, { url, id, visible: false }]);
    const t1 = setTimeout(() => setLayers(prev => prev.map(l => ({ ...l, visible: l.id === id }))), 30);
    const t2 = setTimeout(() => setLayers(prev => prev.filter(l => l.id === id)), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [url]);

  return (
    <div className="np-bg-wrap">
      {layers.map(l => (
        <div
          key={l.id}
          className="np-bg-layer"
          style={{ backgroundImage: `url(${l.url})`, opacity: l.visible ? 1 : 0 }}
        />
      ))}
      <div className="np-bg-overlay" />
    </div>
  );
});

// ─── Modals (reused from QueuePanel) ──────────────────────────────────────────

function SavePlaylistModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <h3 style={{ marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>{t('queue.savePlaylist')}</h3>
        <input
          type="text" className="live-search-field"
          placeholder={t('queue.playlistName')} value={name}
          onChange={e => setName(e.target.value)} autoFocus
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          style={{ width: '100%', marginBottom: '1rem', padding: '10px 16px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t('queue.cancel')}</button>
          <button className="btn btn-primary" onClick={() => name.trim() && onSave(name.trim())}>{t('queue.save')}</button>
        </div>
      </div>
    </div>
  );
}

function LoadPlaylistModal({ onClose, onLoad }: { onClose: () => void; onLoad: (id: string) => void }) {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = () => {
    setLoading(true);
    getPlaylists().then(d => { setPlaylists(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (confirm(t('queue.deleteConfirm', { name }))) { await deletePlaylist(id); fetch(); }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <h3 style={{ marginBottom: '1rem', fontFamily: 'var(--font-display)' }}>{t('queue.loadPlaylist')}</h3>
        {loading ? <p style={{ color: 'var(--text-muted)' }}>{t('queue.loading')}</p>
          : playlists.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>{t('queue.noPlaylists')}</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
              {playlists.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--ctp-surface1)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontWeight: 500 }} className="truncate">{p.name}</span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="nav-btn" onClick={() => onLoad(p.id)} style={{ width: 28, height: 28, background: 'transparent' }}><Play size={14} /></button>
                    <button className="nav-btn" onClick={() => handleDelete(p.id, p.name)} style={{ width: 28, height: 28, background: 'transparent', color: 'var(--ctp-red)' }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

let _dragFromIdx: number | null = null;

export default function NowPlaying() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const currentTrack   = usePlayerStore(s => s.currentTrack);
  const queue          = usePlayerStore(s => s.queue);
  const queueIndex     = usePlayerStore(s => s.queueIndex);
  const contextMenu    = usePlayerStore(s => s.contextMenu);
  const isQueueVisible = usePlayerStore(s => s.isQueueVisible);

  const playTrack      = usePlayerStore(s => s.playTrack);
  const shuffleQueue   = usePlayerStore(s => s.shuffleQueue);
  const reorderQueue   = usePlayerStore(s => s.reorderQueue);
  const removeTrack    = usePlayerStore(s => s.removeTrack);
  const enqueue        = usePlayerStore(s => s.enqueue);
  const clearQueue     = usePlayerStore(s => s.clearQueue);
  const setQueueVisible = usePlayerStore(s => s.setQueueVisible);

  // Hide queue panel while on this page, restore on leave
  useEffect(() => {
    const wasVisible = usePlayerStore.getState().isQueueVisible;
    if (wasVisible) setQueueVisible(false);
    return () => { if (wasVisible) setQueueVisible(true); };
  }, [setQueueVisible]);

  // Extra song metadata (genre) fetched via getSong
  const [songMeta, setSongMeta] = useState<SubsonicSong | null>(null);
  useEffect(() => {
    if (!currentTrack) { setSongMeta(null); return; }
    getSong(currentTrack.id).then(setSongMeta);
  }, [currentTrack?.id]);

  // Favorite state
  const [starred, setStarred] = useState(false);
  useEffect(() => {
    setStarred(!!songMeta?.starred);
  }, [songMeta]);
  const toggleStar = async () => {
    if (!currentTrack) return;
    if (starred) { await unstar(currentTrack.id, 'song'); setStarred(false); }
    else          { await star(currentTrack.id, 'song');   setStarred(true);  }
  };

  // Cover / background
  const coverFetchUrl = currentTrack?.coverArt ? buildCoverArtUrl(currentTrack.coverArt, 800) : '';
  const coverKey      = currentTrack?.coverArt ? coverArtCacheKey(currentTrack.coverArt, 800) : '';
  const resolvedCover = useCachedUrl(coverFetchUrl, coverKey);

  // Queue drag-and-drop
  const [draggedIdx, setDraggedIdx]   = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const isDraggingInternalRef = useRef(false);
  const draggedIdxRef  = useRef<number | null>(null);
  const dragOverIdxRef = useRef<number | null>(null);
  const queueListRef   = useRef<HTMLDivElement>(null);

  const onDragStart = (e: React.DragEvent, index: number) => {
    isDraggingInternalRef.current = true;
    draggedIdxRef.current = index;
    _dragFromIdx = index;
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'queue_reorder', index }));
  };
  const onDragEnterItem = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isDraggingInternalRef.current ? 'move' : 'copy';
  };
  const onDragOverItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isDraggingInternalRef.current ? 'move' : 'copy';
    dragOverIdxRef.current = index;
    setDragOverIdx(index);
  };
  const onDragEnd = () => {
    setDraggedIdx(null); setDragOverIdx(null);
    isDraggingInternalRef.current = false;
    draggedIdxRef.current = null; dragOverIdxRef.current = null;
  };
  const onDropQueue = async (e: React.DragEvent) => {
    e.preventDefault();
    isDraggingInternalRef.current = false;
    draggedIdxRef.current = null; dragOverIdxRef.current = null;
    setDraggedIdx(null); setDragOverIdx(null);

    let parsedData: any = null;
    try { const raw = e.dataTransfer.getData('text/plain'); if (raw) parsedData = JSON.parse(raw); } catch {}

    if (parsedData?.type === 'queue_reorder' || _dragFromIdx !== null) {
      const fromIdx: number = parsedData?.index ?? _dragFromIdx!;
      _dragFromIdx = null;
      let toIdx = queue.length;
      if (queueListRef.current) {
        const items = queueListRef.current.querySelectorAll<HTMLElement>('[data-queue-idx]');
        for (let i = 0; i < items.length; i++) {
          const rect = items[i].getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) { toIdx = parseInt(items[i].dataset.queueIdx!); break; }
        }
      }
      if (fromIdx !== toIdx) reorderQueue(fromIdx, toIdx);
      return;
    }
    _dragFromIdx = null;
    if (!parsedData) return;
    if (parsedData.type === 'song') enqueue([parsedData.track]);
    else if (parsedData.type === 'album') {
      const albumData = await getAlbum(parsedData.id);
      const tracks: Track[] = albumData.songs.map(s => ({
        id: s.id, title: s.title, artist: s.artist, album: s.album,
        albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt,
        track: s.track, year: s.year, bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
      }));
      enqueue(tracks);
    }
  };

  // Playlist modals
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  const totalSecs = queue.reduce((acc, t) => acc + (t.duration || 0), 0);

  return (
    <div className="np-page">
      {/* ── Hero ── */}
      <div className="np-hero">
        <NpBg url={resolvedCover ?? ''} />

        <div className="np-hero-content">
          {currentTrack ? (
            <>
              {/* Cover + glow */}
              <div className="np-cover-wrap">
                {resolvedCover && (
                  <img src={resolvedCover} alt="" className="np-cover-glow" aria-hidden="true" />
                )}
                {resolvedCover
                  ? <img src={resolvedCover} alt="" className="np-cover" />
                  : <div className="np-cover np-cover-fallback"><Music size={64} /></div>
                }
              </div>

              {/* Meta */}
              <div className="np-info">
                <div className="np-title">{currentTrack.title}</div>

                <div className="np-artist-album">
                  <span
                    className="np-link"
                    onClick={() => currentTrack.artistId && navigate(`/artist/${currentTrack.artistId}`)}
                    style={{ cursor: currentTrack.artistId ? 'pointer' : 'default' }}
                  >{currentTrack.artist}</span>
                  <span className="np-sep">·</span>
                  <span
                    className="np-link"
                    onClick={() => currentTrack.albumId && navigate(`/album/${currentTrack.albumId}`)}
                    style={{ cursor: currentTrack.albumId ? 'pointer' : 'default' }}
                  >{currentTrack.album}</span>
                  {currentTrack.year && <><span className="np-sep">·</span><span>{currentTrack.year}</span></>}
                </div>

                <div className="np-tech-row">
                  {songMeta?.genre && <span className="np-badge">{songMeta.genre}</span>}
                  {currentTrack.suffix && <span className="np-badge">{currentTrack.suffix.toUpperCase()}</span>}
                  {currentTrack.bitRate && <span className="np-badge">{currentTrack.bitRate} kbps</span>}
                  {currentTrack.duration && <span className="np-badge">{formatTime(currentTrack.duration)}</span>}
                  {renderStars(currentTrack.userRating)}
                  <button
                    onClick={toggleStar}
                    className="np-star-btn"
                    data-tooltip={starred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
                  >
                    <Star size={18} fill={starred ? 'var(--ctp-yellow)' : 'none'} color={starred ? 'var(--ctp-yellow)' : 'white'} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="np-empty-state">
              <Music size={48} style={{ opacity: 0.3 }} />
              <p>{t('nowPlaying.nothingPlaying')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Queue list ── */}
      <div className="np-queue-section">
        <div className="np-queue-header">
          <div>
            <h2 className="np-queue-title">{t('queue.title')}</h2>
            {queue.length > 0 && (
              <div className="np-queue-meta">
                {queue.length} {queue.length === 1 ? t('queue.trackSingular') : t('queue.trackPlural')} · {formatDuration(totalSecs)}
              </div>
            )}
          </div>
          <div className="np-queue-actions">
            <button onClick={() => shuffleQueue()} className="np-action-btn" data-tooltip={t('queue.shuffle')} disabled={queue.length < 2}>
              <Shuffle size={15} />
            </button>
            <button onClick={() => setSaveModalOpen(true)} className="np-action-btn" data-tooltip={t('queue.save')} disabled={queue.length === 0}>
              <Save size={15} />
            </button>
            <button onClick={() => setLoadModalOpen(true)} className="np-action-btn" data-tooltip={t('queue.load')}>
              <FolderOpen size={15} />
            </button>
            <button onClick={clearQueue} className="np-action-btn" data-tooltip={t('queue.clear')} disabled={queue.length === 0}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div
          className="np-queue-list"
          ref={queueListRef}
          onDragEnter={e => { e.preventDefault(); e.dataTransfer.dropEffect = isDraggingInternalRef.current ? 'move' : 'copy'; }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = isDraggingInternalRef.current ? 'move' : 'copy'; }}
          onDrop={onDropQueue}
        >
          {queue.length === 0 ? (
            <div className="queue-empty">{t('queue.emptyQueue')}</div>
          ) : (
            queue.map((track, idx) => {
              const isActive = idx === queueIndex;
              const isDragging = draggedIdx === idx;
              const isDragOver = dragOverIdx === idx;
              let dragStyle: React.CSSProperties = {};
              if (isDragging) dragStyle = { opacity: 0.4, background: 'var(--bg-hover)' };
              else if (isDragOver && draggedIdx !== null) {
                dragStyle = draggedIdx > idx
                  ? { borderTop: '2px solid var(--accent)', paddingTop: '6px', marginTop: '-2px' }
                  : { borderBottom: '2px solid var(--accent)', paddingBottom: '6px', marginBottom: '-2px' };
              }

              return (
                <div
                  key={`${track.id}-${idx}`}
                  data-queue-idx={idx}
                  className={`np-queue-item ${isActive ? 'active' : ''} ${contextMenu.isOpen && contextMenu.type === 'queue-item' && contextMenu.queueIndex === idx ? 'context-active' : ''}`}
                  onClick={() => playTrack(track, queue)}
                  onContextMenu={e => { e.preventDefault(); usePlayerStore.getState().openContextMenu(e.clientX, e.clientY, track, 'queue-item', idx); }}
                  draggable
                  onDragStart={e => onDragStart(e, idx)}
                  onDragEnter={e => onDragEnterItem(e)}
                  onDragOver={e => onDragOverItem(e, idx)}
                  onDragEnd={onDragEnd}
                  style={dragStyle}
                >
                  <div className="np-queue-num">
                    {isActive
                      ? <Play size={12} fill="var(--accent)" color="var(--accent)" />
                      : <span>{idx + 1}</span>
                    }
                  </div>
                  <div className="np-queue-item-info">
                    <div className={`np-queue-item-title truncate ${isActive ? 'np-queue-item-active' : ''}`}>{track.title}</div>
                    <div className="np-queue-item-artist truncate">{track.artist} · {track.album}</div>
                  </div>
                  <div className="np-queue-item-duration">{formatTime(track.duration)}</div>
                  <button
                    className="np-queue-remove"
                    onClick={e => { e.stopPropagation(); removeTrack(idx); }}
                    data-tooltip={t('queue.remove')}
                  ><X size={13} /></button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {saveModalOpen && (
        <SavePlaylistModal
          onClose={() => setSaveModalOpen(false)}
          onSave={async name => {
            try { await createPlaylist(name, queue.map(t => t.id)); setSaveModalOpen(false); }
            catch (e) { console.error(e); }
          }}
        />
      )}
      {loadModalOpen && (
        <LoadPlaylistModal
          onClose={() => setLoadModalOpen(false)}
          onLoad={async id => {
            try {
              const data = await getPlaylist(id);
              const tracks: Track[] = data.songs.map(s => ({
                id: s.id, title: s.title, artist: s.artist, album: s.album,
                albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt,
                track: s.track, year: s.year, bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
              }));
              if (tracks.length > 0) { clearQueue(); playTrack(tracks[0], tracks); }
              setLoadModalOpen(false);
            } catch (e) { console.error(e); }
          }}
        />
      )}
    </div>
  );
}
