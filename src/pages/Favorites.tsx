import React, { useEffect, useState } from 'react';
import AlbumRow from '../components/AlbumRow';
import ArtistRow from '../components/ArtistRow';
import { getStarred, SubsonicAlbum, SubsonicArtist, SubsonicSong } from '../api/subsonic';
import { usePlayerStore, songToTrack } from '../store/playerStore';
import { ListPlus, Play, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { unstar } from '../api/subsonic';
import { useDragDrop } from '../contexts/DragDropContext';

export default function Favorites() {
  const { t } = useTranslation();
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [artists, setArtists] = useState<SubsonicArtist[]>([]);
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [loading, setLoading] = useState(true);

  const { playTrack, enqueue } = usePlayerStore();
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const starredOverrides = usePlayerStore(s => s.starredOverrides);
  const setStarredOverride = usePlayerStore(s => s.setStarredOverride);
  const psyDrag = useDragDrop();

  function removeSong(id: string) {
    unstar(id, 'song').catch(() => {});
    setStarredOverride(id, false);
    setSongs(prev => prev.filter(s => s.id !== id));
  }
  const openContextMenu = usePlayerStore(s => s.openContextMenu);
  const navigate = useNavigate();

  useEffect(() => {
    getStarred()
      .then(res => {
        setAlbums(res.albums);
        setArtists(res.artists);
        setSongs(res.songs);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  const visibleSongs = songs.filter(s => starredOverrides[s.id] !== false);
  const hasAnyFavorites = albums.length > 0 || artists.length > 0 || visibleSongs.length > 0;

  return (
    <div className="content-body animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
      <div style={{ marginBottom: '-1.5rem' }}>
        <h1 className="page-title">{t('favorites.title')}</h1>
      </div>

      {!hasAnyFavorites ? (
        <div className="empty-state">{t('favorites.empty')}</div>
      ) : (
        <>
          {artists.length > 0 && (
            <ArtistRow title={t('favorites.artists')} artists={artists} />
          )}

          {albums.length > 0 && (
            <AlbumRow title={t('favorites.albums')} albums={albums} />
          )}

          {visibleSongs.length > 0 && (
            <section className="album-row-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                <h2 className="section-title" style={{ margin: 0 }}>{t('favorites.songs')}</h2>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const tracks = visibleSongs.map(songToTrack);
                    playTrack(tracks[0], tracks);
                  }}
                >
                  <Play size={15} />
                  {t('favorites.playAll')}
                </button>
                <button
                  className="btn btn-surface"
                  onClick={() => {
                    const tracks = visibleSongs.map(songToTrack);
                    enqueue(tracks);
                  }}
                >
                  <ListPlus size={15} />
                  {t('favorites.enqueueAll')}
                </button>
              </div>
              <div className="tracklist" style={{ padding: 0 }}>
                <div className="tracklist-header tracklist-va" style={{ gridTemplateColumns: '40px 1fr 1fr 60px 32px' }}>
                  <div className="col-center">#</div>
                  <div>{t('albumDetail.trackTitle')}</div>
                  <div>{t('albumDetail.trackArtist')}</div>
                  <div className="col-center">{t('albumDetail.trackDuration')}</div>
                  <div />
                </div>
                {visibleSongs.map((song, i) => {
                  const track = songToTrack(song);
                  return (
                    <div
                      key={song.id}
                      className="track-row track-row-va"
                      style={{ gridTemplateColumns: '40px 1fr 1fr 60px 32px' }}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('button, a, input')) return;
                        playTrack(track, visibleSongs.map(songToTrack));
                      }}
                      onContextMenu={e => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, track, 'song'); }}
                      role="row"
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        const sx = e.clientX, sy = e.clientY;
                        const onMove = (me: MouseEvent) => {
                          if (Math.abs(me.clientX - sx) > 5 || Math.abs(me.clientY - sy) > 5) {
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            psyDrag.startDrag({ data: JSON.stringify({ type: 'song', track }), label: song.title }, me.clientX, me.clientY);
                          }
                        };
                        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      }}
                    >
                      <div className={`track-num${currentTrack?.id === song.id ? ' track-num-active' : ''}`} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); playTrack(track, visibleSongs.map(songToTrack)); }}>
                        {currentTrack?.id === song.id && isPlaying && <span className="track-num-eq"><div className="eq-bars"><span className="eq-bar" /><span className="eq-bar" /><span className="eq-bar" /></div></span>}
                        <span className="track-num-play"><Play size={13} fill="currentColor" /></span>
                        <span className="track-num-number">{i + 1}</span>
                      </div>
                      <div className="track-info">
                        <span className="track-title">{song.title}</span>
                      </div>
                      <div className="track-artist-cell">
                        <span
                          className={`track-artist${song.artistId ? ' track-artist-link' : ''}`}
                          style={{ cursor: song.artistId ? 'pointer' : 'default' }}
                          onClick={() => song.artistId && navigate(`/artist/${song.artistId}`)}
                        >{song.artist}</span>
                      </div>
                      <div className="track-duration">
                        {Math.floor(song.duration / 60)}:{(song.duration % 60).toString().padStart(2, '0')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <button
                          className="btn-icon fav-remove-btn"
                          data-tooltip={t('favorites.removeSong')}
                          onClick={e => { e.stopPropagation(); removeSong(song.id); }}
                          aria-label={t('favorites.removeSong')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
