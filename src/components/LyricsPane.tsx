import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import type { LrcLine } from '../api/lrclib';
import { useLyrics } from '../hooks/useLyrics';
import { useTranslation } from 'react-i18next';
import type { Track } from '../store/playerStore';

interface Props {
  currentTrack: Track | null;
}

export default function LyricsPane({ currentTrack }: Props) {
  const { t } = useTranslation();

  const { syncedLines, plainLyrics, source, loading, notFound } = useLyrics(currentTrack);

  const hasSynced   = syncedLines !== null && syncedLines.length > 0;
  const currentTime = usePlayerStore(s => hasSynced ? s.currentTime : 0);
  const seek        = usePlayerStore(s => s.seek);
  const duration    = usePlayerStore(s => s.currentTrack?.duration ?? 0);

  const lineRefs   = useRef<(HTMLDivElement | null)[]>([]);
  const prevActive = useRef(-1);

  // Reset refs when track changes
  useEffect(() => {
    lineRefs.current = [];
    prevActive.current = -1;
  }, [currentTrack?.id]);

  const activeIdx = hasSynced
    ? (syncedLines as LrcLine[]).reduce((acc, line, i) => (currentTime >= line.time ? i : acc), -1)
    : -1;

  useEffect(() => {
    if (activeIdx < 0 || activeIdx === prevActive.current) return;
    prevActive.current = activeIdx;
    lineRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  if (!currentTrack) {
    return (
      <div className="lyrics-pane-empty">
        <p className="lyrics-status">{t('player.lyricsNotFound')}</p>
      </div>
    );
  }

  const getLyricLineClass = (i: number, active: number) => {
    const base = 'lyrics-line';
    if (i > active) return base;
    if (i < active) return `${base} completed`;
    return `${base} active`;
  };

  const sourceLabel = source === 'server'
    ? t('player.lyricsSourceServer')
    : source === 'lrclib'
      ? t('player.lyricsSourceLrclib')
      : source === 'netease'
        ? t('player.lyricsSourceNetease')
        : null;

  return (
    <div className="lyrics-pane">
      {loading && <p className="lyrics-status">{t('player.lyricsLoading')}</p>}
      {notFound && !loading && <p className="lyrics-status">{t('player.lyricsNotFound')}</p>}
      {hasSynced && (
        <div className="lyrics-synced">
          {(syncedLines as LrcLine[]).map((line, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className={getLyricLineClass(i, activeIdx)}
              onClick={() => { if (duration > 0) seek(line.time / duration); }}
              style={{ cursor: 'pointer' }}
            >
              {line.text || '\u00A0'}
            </div>
          ))}
        </div>
      )}
      {!hasSynced && plainLyrics && (
        <div className="lyrics-plain">
          {plainLyrics.split('\n').map((line, i) => (
            <p key={i} className="lyrics-plain-line">{line || '\u00A0'}</p>
          ))}
        </div>
      )}
      {sourceLabel && !loading && !notFound && (
        <p className="lyrics-source">{sourceLabel}</p>
      )}
    </div>
  );
}
