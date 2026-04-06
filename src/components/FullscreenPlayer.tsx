import React, { useCallback, useEffect, useState, useRef, memo, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  ChevronDown, Repeat, Repeat1, Square, Music, Heart
} from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { buildCoverArtUrl, coverArtCacheKey, getArtistInfo, star, unstar } from '../api/subsonic';
import CachedImage, { useCachedUrl } from './CachedImage';
import { useTranslation } from 'react-i18next';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Artist portrait — right half, crossfades on track change ─────────────────
const FsPortrait = memo(function FsPortrait({ url }: { url: string }) {
  const [layers, setLayers] = useState<Array<{ url: string; id: number; visible: boolean }>>(() =>
    url ? [{ url, id: 0, visible: true }] : []
  );
  const counterRef = useRef(1);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const id = counterRef.current++;
    const img = new Image();
    img.onload = img.onerror = () => {
      if (cancelled) return;
      setLayers(prev => [...prev, { url, id, visible: false }]);
      requestAnimationFrame(() => {
        if (cancelled) return;
        setLayers(prev => prev.map(l => ({ ...l, visible: l.id === id })));
        setTimeout(() => {
          if (!cancelled) setLayers(prev => prev.filter(l => l.id === id));
        }, 1000);
      });
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);

  if (layers.length === 0) return null;

  return (
    <div className="fs-portrait-wrap" aria-hidden="true">
      {layers.map(layer => (
        <img
          key={layer.id}
          src={layer.url}
          className="fs-portrait"
          style={{ opacity: layer.visible ? 1 : 0 }}
          decoding="async"
          loading="eager"
          alt=""
        />
      ))}
    </div>
  );
});

// ─── Full-width seekbar (isolated — re-renders every tick) ────────────────────
const FsSeekbar = memo(function FsSeekbar({ duration }: { duration: number }) {
  const progress    = usePlayerStore(s => s.progress);
  const buffered    = usePlayerStore(s => s.buffered);
  const currentTime = usePlayerStore(s => s.currentTime);
  const seek        = usePlayerStore(s => s.seek);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => seek(parseFloat(e.target.value)),
    [seek]
  );

  const pct = progress * 100;
  const buf = Math.max(pct, buffered * 100);

  return (
    <div className="fs-seekbar-wrap">
      <div className="fs-seekbar-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="fs-seekbar">
        <div className="fs-seekbar-bg" />
        <div className="fs-seekbar-buf" style={{ width: `${buf}%` }} />
        <div className="fs-seekbar-played" style={{ width: `${pct}%` }} />
        <input
          type="range" min={0} max={1} step={0.001}
          value={progress}
          onChange={handleSeek}
          aria-label="seek"
        />
      </div>
    </div>
  );
});

// ─── Play/Pause button (isolated — subscribes to isPlaying only) ──────────────
const FsPlayBtn = memo(function FsPlayBtn() {
  const { t } = useTranslation();
  const isPlaying  = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  return (
    <button className="fs-btn fs-btn-play" onClick={togglePlay} aria-label={isPlaying ? t('player.pause') : t('player.play')}>
      {isPlaying ? <Pause size={25} /> : <Play size={25} fill="currentColor" />}
    </button>
  );
});

// ─── Main component ────────────────────────────────────────────────────────────
interface FullscreenPlayerProps {
  onClose: () => void;
}

export default function FullscreenPlayer({ onClose }: FullscreenPlayerProps) {
  const { t } = useTranslation();
  const currentTrack       = usePlayerStore(s => s.currentTrack);
  const repeatMode         = usePlayerStore(s => s.repeatMode);
  const next               = usePlayerStore(s => s.next);
  const previous           = usePlayerStore(s => s.previous);
  const stop               = usePlayerStore(s => s.stop);
  const toggleRepeat       = usePlayerStore(s => s.toggleRepeat);
  const starredOverrides   = usePlayerStore(s => s.starredOverrides);
  const setStarredOverride = usePlayerStore(s => s.setStarredOverride);

  const isStarred = currentTrack
    ? (currentTrack.id in starredOverrides ? starredOverrides[currentTrack.id] : !!currentTrack.starred)
    : false;

  const toggleStar = useCallback(async () => {
    if (!currentTrack) return;
    const nextVal = !isStarred;
    setStarredOverride(currentTrack.id, nextVal);
    try {
      if (nextVal) await star(currentTrack.id, 'song');
      else await unstar(currentTrack.id, 'song');
    } catch {
      setStarredOverride(currentTrack.id, !nextVal);
    }
  }, [currentTrack, isStarred, setStarredOverride]);

  const duration = currentTrack?.duration ?? 0;

  // buildCoverArtUrl generates a new salt on every call — must be memoized.
  const coverUrl = useMemo(() => currentTrack?.coverArt ? buildCoverArtUrl(currentTrack.coverArt, 500) : '', [currentTrack?.coverArt]);
  const coverKey = useMemo(() => currentTrack?.coverArt ? coverArtCacheKey(currentTrack.coverArt, 500) : '', [currentTrack?.coverArt]);
  // `false` = no fetchUrl fallback — prevents double crossfade (fetchUrl → blobUrl).
  const resolvedCoverUrl = useCachedUrl(coverUrl, coverKey, false);

  // Artist image → portrait on right. Falls back to cover art.
  const [artistBgUrl, setArtistBgUrl] = useState<string>('');
  useEffect(() => {
    setArtistBgUrl('');
    const artistId = currentTrack?.artistId;
    if (!artistId) return;
    let cancelled = false;
    getArtistInfo(artistId).then(info => {
      if (!cancelled && info.largeImageUrl) setArtistBgUrl(info.largeImageUrl);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack?.artistId]);

  const portraitUrl = artistBgUrl || resolvedCoverUrl;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const metaParts = [
    currentTrack?.album,
    currentTrack?.year?.toString(),
    currentTrack?.suffix?.toUpperCase(),
    currentTrack?.bitRate ? `${currentTrack.bitRate} kbps` : '',
  ].filter(Boolean);

  return (
    <div className="fs-player" role="dialog" aria-modal="true" aria-label={t('player.fullscreen')}>

      {/* Layer 0 — animated dark mesh gradient (real divs = will-change possible) */}
      <div className="fs-mesh-bg" aria-hidden="true">
        <div className="fs-mesh-blob fs-mesh-blob-a" />
        <div className="fs-mesh-blob fs-mesh-blob-b" />
      </div>

      {/* Layer 1 — artist portrait, right half, object-fit: contain */}
      <FsPortrait url={portraitUrl} />

      {/* Layer 2 — horizontal scrim: dark left → transparent right */}
      <div className="fs-scrim" aria-hidden="true" />

      {/* Close */}
      <button className="fs-close" onClick={onClose} aria-label={t('player.closeFullscreen')}>
        <ChevronDown size={28} />
      </button>

      {/* Layer 3 — info cluster, bottom-left */}
      <div className="fs-cluster">

        {/* Album art */}
        <div className="fs-art-wrap">
          {coverUrl ? (
            <CachedImage
              src={coverUrl}
              cacheKey={coverKey}
              alt={`${currentTrack?.album} Cover`}
              className="fs-art"
            />
          ) : (
            <div className="fs-art fs-art-placeholder"><Music size={40} /></div>
          )}
        </div>

        {/* Artist — massive statement */}
        <p className="fs-artist-name">{currentTrack?.artist ?? '—'}</p>

        {/* Track title — accent, light weight */}
        <p className="fs-track-title">{currentTrack?.title ?? '—'}</p>

        {/* Metadata row */}
        {metaParts.length > 0 && (
          <div className="fs-meta">
            {metaParts.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="fs-meta-dot">·</span>}
                <span>{part}</span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="fs-controls">
          <button className="fs-btn fs-btn-sm" onClick={stop} aria-label="Stop" data-tooltip={t('player.stop')}>
            <Square size={13} fill="currentColor" />
          </button>
          <button className="fs-btn" onClick={() => previous()} aria-label={t('player.prev')} data-tooltip={t('player.prev')}>
            <SkipBack size={19} />
          </button>
          <FsPlayBtn />
          <button className="fs-btn" onClick={() => next()} aria-label={t('player.next')} data-tooltip={t('player.next')}>
            <SkipForward size={19} />
          </button>
          <button
            className={`fs-btn fs-btn-sm${repeatMode !== 'off' ? ' active' : ''}`}
            onClick={toggleRepeat}
            aria-label={t('player.repeat')}
            data-tooltip={`${t('player.repeat')}: ${repeatMode === 'off' ? t('player.repeatOff') : repeatMode === 'all' ? t('player.repeatAll') : t('player.repeatOne')}`}
          >
            {repeatMode === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
          </button>
          {currentTrack && (
            <button
              className={`fs-btn fs-btn-sm fs-btn-heart${isStarred ? ' active' : ''}`}
              onClick={toggleStar}
              aria-label={isStarred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
              data-tooltip={isStarred ? t('contextMenu.unfavorite') : t('contextMenu.favorite')}
            >
              <Heart size={14} fill={isStarred ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

      </div>

      {/* Layer 4 — full-width seekbar, bottom edge */}
      <FsSeekbar duration={duration} />

    </div>
  );
}
