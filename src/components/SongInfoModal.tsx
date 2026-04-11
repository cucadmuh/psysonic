import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePlayerStore } from '../store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { getSong, SubsonicSong } from '../api/subsonic';
import { useTranslation } from 'react-i18next';

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000).toFixed(0)} KB`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <tr>
      <td className="song-info-label">{label}</td>
      <td className="song-info-value">{value}</td>
    </tr>
  );
}

function Divider() {
  return <tr><td colSpan={2} className="song-info-divider" /></tr>;
}

export default function SongInfoModal() {
  const { t } = useTranslation();
  const { songInfoModal, closeSongInfo } = usePlayerStore(
    useShallow(s => ({ songInfoModal: s.songInfoModal, closeSongInfo: s.closeSongInfo }))
  );
  const [song, setSong] = useState<SubsonicSong | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!songInfoModal.isOpen || !songInfoModal.songId) {
      setSong(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSong(songInfoModal.songId).then(s => {
      if (!cancelled) { setSong(s); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [songInfoModal.isOpen, songInfoModal.songId]);

  useEffect(() => {
    if (!songInfoModal.isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSongInfo(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [songInfoModal.isOpen, closeSongInfo]);

  if (!songInfoModal.isOpen) return null;

  const channels = song?.channelCount === 1
    ? t('songInfo.mono')
    : song?.channelCount === 2
      ? t('songInfo.stereo')
      : song?.channelCount
        ? `${song.channelCount} ch`
        : null;

  const trackLabel = song?.discNumber && song.discNumber > 1
    ? `${song.discNumber} – ${song.track}`
    : song?.track != null
      ? String(song.track)
      : null;

  const hasReplayGain = song?.replayGain &&
    (song.replayGain.trackGain !== undefined || song.replayGain.albumGain !== undefined);

  return createPortal(
    <>
      <div className="song-info-backdrop" onClick={closeSongInfo} />
      <div className="song-info-modal" role="dialog" aria-modal="true" aria-label={t('songInfo.title')}>
        <div className="song-info-header">
          <span className="song-info-title">{t('songInfo.title')}</span>
          <button className="btn btn-ghost song-info-close" onClick={closeSongInfo} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="song-info-body">
          {loading && <div className="song-info-loading">{t('common.loading')}</div>}

          {!loading && song && (
            <table className="song-info-table">
              <tbody>
                <Row label={t('songInfo.songTitle')} value={song.title} />
                <Row label={t('songInfo.artist')} value={song.artist} />
                <Row label={t('songInfo.album')} value={song.album} />
                {song.albumArtist && song.albumArtist !== song.artist && (
                  <Row label={t('songInfo.albumArtist')} value={song.albumArtist} />
                )}
                <Row label={t('songInfo.year')} value={song.year} />
                <Row label={t('songInfo.genre')} value={song.genre} />
                <Row label={t('songInfo.duration')} value={formatDuration(song.duration)} />
                <Row label={t('songInfo.track')} value={trackLabel} />

                <Divider />

                <Row label={t('songInfo.format')} value={[song.suffix?.toUpperCase(), song.contentType].filter(Boolean).join(' · ') || null} />
                <Row label={t('songInfo.bitrate')} value={song.bitRate ? `${song.bitRate} kbps` : null} />
                <Row label={t('songInfo.sampleRate')} value={song.samplingRate ? `${(song.samplingRate / 1000).toFixed(1)} kHz` : null} />
                <Row label={t('songInfo.bitDepth')} value={song.bitDepth ? `${song.bitDepth} bit` : null} />
                <Row label={t('songInfo.channels')} value={channels} />
                <Row label={t('songInfo.fileSize')} value={formatSize(song.size)} />

                {song.path && (
                  <>
                    <Divider />
                    <Row label={t('songInfo.path')} value={<span className="song-info-path">{song.path}</span>} />
                  </>
                )}

                {hasReplayGain && (
                  <>
                    <Divider />
                    {song.replayGain!.trackGain !== undefined && (
                      <Row label={t('songInfo.replayGainTrack')} value={`${song.replayGain!.trackGain >= 0 ? '+' : ''}${song.replayGain!.trackGain.toFixed(2)} dB`} />
                    )}
                    {song.replayGain!.albumGain !== undefined && (
                      <Row label={t('songInfo.replayGainAlbum')} value={`${song.replayGain!.albumGain >= 0 ? '+' : ''}${song.replayGain!.albumGain.toFixed(2)} dB`} />
                    )}
                    {song.replayGain!.trackPeak !== undefined && (
                      <Row label={t('songInfo.replayGainPeak')} value={song.replayGain!.trackPeak.toFixed(6)} />
                    )}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
