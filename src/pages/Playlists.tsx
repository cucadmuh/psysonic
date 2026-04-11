import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListMusic, Play, Plus, Trash2, X } from 'lucide-react';
import { getPlaylists, createPlaylist, deletePlaylist, SubsonicPlaylist, getPlaylist, buildCoverArtUrl, coverArtCacheKey } from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import CachedImage from '../components/CachedImage';
import { useTranslation } from 'react-i18next';
import { formatHumanHoursMinutes } from '../utils/formatHumanDuration';

function formatDuration(seconds: number): string {
  return formatHumanHoursMinutes(seconds);
}

export default function Playlists() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const playTrack = usePlayerStore(s => s.playTrack);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const removeId = usePlaylistStore((s) => s.removeId);

  const [playlists, setPlaylists] = useState<SubsonicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPlaylists()
      .then(setPlaylists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (creating) nameInputRef.current?.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim() || t('playlists.unnamed');
    try {
      await createPlaylist(name);
      const updated = await getPlaylists();
      setPlaylists(updated);
    } catch {}
    setCreating(false);
    setNewName('');
  };

  const handlePlay = async (e: React.MouseEvent, pl: SubsonicPlaylist) => {
    e.stopPropagation();
    if (playingId === pl.id) return;
    setPlayingId(pl.id);
    try {
      const data = await getPlaylist(pl.id);
      const tracks = data.songs.map(songToTrack);
      if (tracks.length > 0) {
        touchPlaylist(pl.id);
        playTrack(tracks[0], tracks);
      }
    } catch {}
    setPlayingId(null);
  };

  const handleDelete = async (e: React.MouseEvent, pl: SubsonicPlaylist) => {
    e.stopPropagation();
    if (deleteConfirmId !== pl.id) {
      setDeleteConfirmId(pl.id);
      return;
    }
    try {
      await deletePlaylist(pl.id);
      removeId(pl.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
    } catch {}
    setDeleteConfirmId(null);
  };

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="content-body animate-fade-in">

      {/* ── Header row ── */}
      <div className="playlists-header">
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('playlists.title')}</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {creating ? (
            <>
              <input
                ref={nameInputRef}
                className="input"
                style={{ width: 220 }}
                placeholder={t('playlists.createName')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                }}
              />
              <button className="btn btn-primary" onClick={handleCreate}>
                {t('playlists.create')}
              </button>
              <button className="btn btn-surface" onClick={() => { setCreating(false); setNewName(''); }}>
                {t('playlists.cancel')}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> {t('playlists.newPlaylist')}
            </button>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      {playlists.length === 0 ? (
        <div className="empty-state">{t('playlists.empty')}</div>
      ) : (
        <div className="album-grid-wrap">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className="album-card"
              onClick={() => navigate(`/playlists/${pl.id}`)}
              onMouseLeave={() => { if (deleteConfirmId === pl.id) setDeleteConfirmId(null); }}
            >
              {/* Cover area — server collage or fallback icon */}
              <div className="album-card-cover">
                {pl.coverArt ? (
                  <CachedImage
                    src={buildCoverArtUrl(pl.coverArt, 256)}
                    cacheKey={coverArtCacheKey(pl.coverArt, 256)}
                    alt={pl.name}
                    className="album-card-cover-img"
                  />
                ) : (
                  <div className="album-card-cover-placeholder playlist-card-icon">
                    <ListMusic size={48} strokeWidth={1.2} />
                  </div>
                )}

                {/* Play overlay — same pattern as AlbumCard */}
                <div className="album-card-play-overlay">
                  <button
                    className="album-card-details-btn"
                    onClick={(e) => handlePlay(e, pl)}
                    disabled={playingId === pl.id}
                  >
                    {playingId === pl.id
                      ? <span className="spinner" style={{ width: 14, height: 14 }} />
                      : <Play size={15} fill="currentColor" />
                    }
                  </button>
                </div>

                {/* Delete button — top-right corner */}
                <button
                  className={`playlist-card-delete ${deleteConfirmId === pl.id ? 'playlist-card-delete--confirm' : ''}`}
                  onClick={(e) => handleDelete(e, pl)}
                  data-tooltip={deleteConfirmId === pl.id ? t('playlists.confirmDelete') : t('playlists.deletePlaylist')}
                  data-tooltip-pos="bottom"
                >
                  {deleteConfirmId === pl.id ? <Trash2 size={12} /> : <X size={12} />}
                </button>
              </div>

              <div className="album-card-info">
                <div className="album-card-title">{pl.name}</div>
                <div className="album-card-artist">
                  {t('playlists.songs', { n: pl.songCount })}
                  {pl.duration > 0 && <> · {formatDuration(pl.duration)}</>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
