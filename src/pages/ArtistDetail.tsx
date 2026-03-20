import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getArtist, getArtistInfo, getTopSongs, getSimilarSongs2, search, SubsonicArtist, SubsonicAlbum, SubsonicSong, SubsonicArtistInfo, buildCoverArtUrl, coverArtCacheKey, star, unstar } from '../api/subsonic';
import AlbumCard from '../components/AlbumCard';
import CachedImage from '../components/CachedImage';
import { ArrowLeft, Users, ExternalLink, Star, Play, Shuffle, Radio } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { usePlayerStore } from '../store/playerStore';
import { useTranslation } from 'react-i18next';
import { lastfmGetSimilarArtists, lastfmIsConfigured } from '../api/lastfm';
import LastfmIcon from '../components/LastfmIcon';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Strip dangerous tags/attributes from server-provided HTML */
function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form, input, button, select, base, meta, link').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase().trim();
      if (name.startsWith('on') || (name === 'href' && (val.startsWith('javascript:') || val.startsWith('data:'))) || (name === 'src' && (val.startsWith('javascript:') || val.startsWith('data:')))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}


export default function ArtistDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [artist, setArtist] = useState<SubsonicArtist | null>(null);
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [featuredAlbums, setFeaturedAlbums] = useState<SubsonicAlbum[]>([]);
  const [topSongs, setTopSongs] = useState<SubsonicSong[]>([]);
  const [info, setInfo] = useState<SubsonicArtistInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [radioLoading, setRadioLoading] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  const [similarArtists, setSimilarArtists] = useState<SubsonicArtist[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  const playTrack = usePlayerStore(state => state.playTrack);
  const enqueue = usePlayerStore(state => state.enqueue);
  const clearQueue = usePlayerStore(state => state.clearQueue);
  const openContextMenu = usePlayerStore(state => state.openContextMenu);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    let ownAlbumIds: Set<string>;
    getArtist(id).then(artistData => {
      setArtist(artistData.artist);
      setAlbums(artistData.albums);
      setIsStarred(!!artistData.artist.starred);
      ownAlbumIds = new Set(artistData.albums.map(a => a.id));
      return Promise.all([
        getArtistInfo(id).catch(() => null),
        getTopSongs(artistData.artist.name).catch(() => []),
        search(artistData.artist.name, { songCount: 500, artistCount: 0, albumCount: 0 }).catch(() => ({ songs: [], albums: [], artists: [] })),
      ]);
    }).then(([artistInfo, songsData, searchResults]) => {
      if (artistInfo !== undefined) setInfo(artistInfo as SubsonicArtistInfo | null);
      if (songsData !== undefined) setTopSongs(songsData as SubsonicSong[]);

      const featuredSongs = (searchResults.songs ?? []).filter(
        song => song.artistId === id && !ownAlbumIds.has(song.albumId)
      );
      const albumMap = new Map<string, SubsonicAlbum>();
      featuredSongs.forEach(song => {
        if (!albumMap.has(song.albumId)) {
          albumMap.set(song.albumId, {
            id: song.albumId,
            name: song.album,
            artist: song.albumArtist ?? '',
            artistId: '',
            coverArt: song.coverArt,
            songCount: 1,
            duration: song.duration,
            year: song.year,
          });
        } else {
          const a = albumMap.get(song.albumId)!;
          a.songCount++;
          a.duration += song.duration;
        }
      });
      setFeaturedAlbums([...albumMap.values()]);

      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!artist || !lastfmIsConfigured()) return;
    setSimilarArtists([]);
    setSimilarLoading(true);
    lastfmGetSimilarArtists(artist.name).then(async names => {
      if (names.length === 0) { setSimilarLoading(false); return; }
      const results = await Promise.all(
        names.slice(0, 30).map(name =>
          search(name, { artistCount: 3, albumCount: 0, songCount: 0 }).catch(() => ({ artists: [], albums: [], songs: [] }))
        )
      );
      const seen = new Set<string>([artist.id]);
      const found: SubsonicArtist[] = [];
      for (let i = 0; i < results.length; i++) {
        const targetName = names[i].toLowerCase();
        const match = results[i].artists.find(a => a.name.toLowerCase() === targetName);
        if (match && !seen.has(match.id)) {
          seen.add(match.id);
          found.push(match);
        }
      }
      setSimilarArtists(found);
      setSimilarLoading(false);
    }).catch(() => setSimilarLoading(false));
  }, [artist?.id]);

  const openLink = (url: string, key: string) => {
    open(url);
    setOpenedLink(key);
    setTimeout(() => setOpenedLink(null), 2500);
  };

  const toggleStar = async () => {
    if (!artist) return;
    const currentlyStarred = isStarred;
    setIsStarred(!currentlyStarred);
    try {
      if (currentlyStarred) await unstar(artist.id, 'artist');
      else await star(artist.id, 'artist');
    } catch (e) {
      console.error('Failed to toggle star', e);
      setIsStarred(currentlyStarred);
    }
  };

  const handlePlayAll = () => {
    if (topSongs.length > 0) {
      clearQueue();
      playTrack(topSongs[0], topSongs);
    }
  };

  const handleShuffle = () => {
    if (topSongs.length > 0) {
      const shuffled = [...topSongs].sort(() => Math.random() - 0.5);
      clearQueue();
      playTrack(shuffled[0], shuffled);
    }
  };

  const handleStartRadio = async () => {
    if (!artist) return;
    setRadioLoading(true);
    try {
      const similar = await getSimilarSongs2(artist.id, 50);
      if (similar.length > 0) {
        clearQueue();
        playTrack(similar[0], similar);
      } else {
        alert(t('artistDetail.noRadio'));
      }
    } catch (e) {
      console.error('Radio start failed', e);
    } finally {
      setRadioLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="content-body" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="content-body">
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          {t('artistDetail.notFound')}
        </div>
      </div>
    );
  }

  const coverId = artist.coverArt || artist.id;
  const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(artist.name)}`;

  return (
    <div className="content-body animate-fade-in">
      <button
        className="btn btn-ghost"
        onClick={() => navigate(-1)}
        style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <ArrowLeft size={16} /> <span>{t('artistDetail.back')}</span>
      </button>

      <div className="artist-detail-header">
        <div className="artist-detail-avatar">
          {coverId ? (
            <CachedImage
              src={buildCoverArtUrl(coverId, 300)}
              cacheKey={coverArtCacheKey(coverId, 300)}
              alt={artist.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <Users size={64} color="var(--text-muted)" />
          )}
        </div>

        <div className="artist-detail-meta">
          <h1 className="page-title" style={{ fontSize: '3rem', marginBottom: '0.25rem' }}>
            {artist.name}
          </h1>
          <div style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1rem' }}>
            {t('artistDetail.albumCount_other', { count: artist.albumCount ?? 0 })}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(info?.lastFmUrl || artist.name) && (
              <div className="artist-detail-links">
                {info?.lastFmUrl && (
                  <button className="artist-ext-link" onClick={() => openLink(info.lastFmUrl!, 'lastfm')}>
                    <LastfmIcon size={14} />
                    {openedLink === 'lastfm' ? t('artistDetail.openedInBrowser') : 'Last.fm'}
                  </button>
                )}
                <button className="artist-ext-link" onClick={() => openLink(wikiUrl, 'wiki')}>
                  <ExternalLink size={14} />
                  {openedLink === 'wiki' ? t('artistDetail.openedInBrowser') : 'Wikipedia'}
                </button>
              </div>
            )}

            <button
              className="artist-ext-link"
              onClick={toggleStar}
              data-tooltip={isStarred ? t('artistDetail.favoriteRemove') : t('artistDetail.favoriteAdd')}
              style={{ color: isStarred ? 'var(--accent)' : 'inherit', border: isStarred ? '1px solid var(--accent)' : undefined }}
            >
              <Star size={14} fill={isStarred ? "currentColor" : "none"} />
              {t('artistDetail.favorite')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            {topSongs.length > 0 && (
              <>
                <button className="btn btn-primary" onClick={handlePlayAll}>
                  <Play size={16} /> {t('artistDetail.playAll')}
                </button>
                <button className="btn btn-surface" onClick={handleShuffle}>
                  <Shuffle size={16} /> {t('artistDetail.shuffle')}
                </button>
              </>
            )}
            <button className="btn btn-surface" onClick={handleStartRadio} disabled={radioLoading}>
              {radioLoading ? <div className="spinner" style={{ width: 16, height: 16, borderTopColor: 'currentColor' }} /> : <Radio size={16} />}
              {radioLoading ? t('artistDetail.loading') : t('artistDetail.radio')}
            </button>
          </div>
        </div>
      </div>

      {/* Biography — sanitized HTML from server */}
      {info?.biography && (
        <div className="artist-bio-section">
          <div
            className="artist-bio-text"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(info.biography) }}
          />
        </div>
      )}

      {/* Top Songs */}
      {topSongs.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: info?.biography ? '2rem' : '0', marginBottom: '1rem' }}>
            {t('artistDetail.topTracks')}
          </h2>
          <div className="tracklist" style={{ padding: 0, marginBottom: '2rem' }}>
            <div className="tracklist-header" style={{ gridTemplateColumns: '36px minmax(150px, 2fr) minmax(100px, 1fr) 60px' }}>
              <div style={{ textAlign: 'center' }}>#</div>
              <div>{t('artistDetail.trackTitle')}</div>
              <div>{t('artistDetail.trackAlbum')}</div>
              <div style={{ textAlign: 'right' }}>{t('artistDetail.trackDuration')}</div>
            </div>
            {topSongs.map((song, idx) => (
              <div
                key={song.id}
                className="track-row"
                style={{ gridTemplateColumns: '36px minmax(150px, 2fr) minmax(100px, 1fr) 60px' }}
                onDoubleClick={() => playTrack(song, topSongs)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const track = {
                    id: song.id, title: song.title, artist: song.artist, album: song.album,
                    albumId: song.albumId, artistId: song.artistId, duration: song.duration, coverArt: song.coverArt, track: song.track,
                    year: song.year, bitRate: song.bitRate, suffix: song.suffix, userRating: song.userRating,
                  };
                  openContextMenu(e.clientX, e.clientY, track, 'song');
                }}
              >
                <div className="track-num" style={{ textAlign: 'center' }}>{idx + 1}</div>
                <div className="track-info" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {song.coverArt && (
                    <CachedImage
                      src={buildCoverArtUrl(song.coverArt, 64)}
                      cacheKey={coverArtCacheKey(song.coverArt, 64)}
                      alt={song.album}
                      style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div className="track-title">{song.title}</div>
                  </div>
                </div>
                <div className="track-album truncate" style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                  {song.album}
                </div>
                <div className="track-duration" style={{ textAlign: 'right' }}>
                  {formatDuration(song.duration)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Similar Artists (Last.fm) */}
      {lastfmIsConfigured() && (similarLoading || similarArtists.length > 0) && (
        <>
          <h2 className="section-title" style={{ marginTop: '2rem', marginBottom: '1rem' }}>
            {t('artistDetail.similarArtists')}
          </h2>
          {similarLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              <div className="spinner" style={{ width: 16, height: 16, borderTopColor: 'currentColor' }} />
              {t('artistDetail.loading')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {similarArtists.map(a => (
                <button
                  key={a.id}
                  className="artist-ext-link"
                  onClick={() => navigate(`/artist/${a.id}`)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Albums */}
      <h2 className="section-title" style={{ marginTop: (info?.biography || topSongs.length > 0 || lastfmIsConfigured()) ? '2rem' : '0', marginBottom: '1rem' }}>
        {t('artistDetail.albumsBy', { name: artist.name })}
      </h2>

      {albums.length > 0 ? (
        <div className="album-grid-wrap">
          {albums.map(a => <AlbumCard key={a.id} album={a} />)}
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>{t('artistDetail.noAlbums')}</p>
      )}

      {/* Also Featured On */}
      {featuredAlbums.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: '2rem', marginBottom: '1rem' }}>
            {t('artistDetail.featuredOn')}
          </h2>
          <div className="album-grid-wrap">
            {featuredAlbums.map(a => <AlbumCard key={a.id} album={a} />)}
          </div>
        </>
      )}
    </div>
  );
}
