import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../store/playerStore';
import type { LrcLine } from '../api/lrclib';
import { useLyrics, type WordLyricsLine } from '../hooks/useLyrics';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';
import type { Track } from '../store/playerStore';

interface Props {
  currentTrack: Track | null;
}

/**
 * Word-sync highlighting is driven imperatively via `usePlayerStore.subscribe`
 * so the whole lyrics block doesn't re-render on every 500 ms progress tick.
 * Active-line scroll is still React-state-driven — lines change infrequently.
 */
export default function LyricsPane({ currentTrack }: Props) {
  const { t } = useTranslation();

  const { syncedLines, wordLines, plainLyrics, source, loading, notFound } = useLyrics(currentTrack);
  const { staticOnly } = useAuthStore(useShallow(s => ({ staticOnly: s.lyricsStaticOnly })));

  const useWords  = !staticOnly && wordLines !== null && wordLines.length > 0;
  const hasSynced = !staticOnly && !useWords && syncedLines !== null && syncedLines.length > 0;

  const seek     = usePlayerStore(s => s.seek);
  const duration = usePlayerStore(s => s.currentTrack?.duration ?? 0);

  const lineRefs   = useRef<(HTMLDivElement | null)[]>([]);
  const wordRefs   = useRef<HTMLSpanElement[][]>([]);
  const prevActive = useRef({ line: -1, word: -1 });

  // Reset refs when track changes.
  useEffect(() => {
    lineRefs.current = [];
    wordRefs.current = [];
    prevActive.current = { line: -1, word: -1 };
  }, [currentTrack?.id]);

  // Imperative tracker for line+word highlighting. Subscribes directly to the
  // store to skip React render cycles for 500 ms progress ticks.
  useEffect(() => {
    if (!useWords && !hasSynced) return;

    const apply = (time: number) => {
      const lines = useWords ? (wordLines as WordLyricsLine[]) : (syncedLines as LrcLine[]);
      let lineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (time >= lines[i].time) lineIdx = i;
        else break;
      }

      let wordIdx = -1;
      if (useWords && lineIdx >= 0) {
        const words = (wordLines as WordLyricsLine[])[lineIdx].words;
        for (let j = 0; j < words.length; j++) {
          if (time >= words[j].time) wordIdx = j;
          else break;
        }
      }

      const prev = prevActive.current;
      if (prev.line === lineIdx && prev.word === wordIdx) return;

      // Update line classes.
      if (prev.line !== lineIdx) {
        if (prev.line >= 0) {
          const el = lineRefs.current[prev.line];
          if (el) el.className = lineClass(prev.line, lineIdx);
        }
        if (lineIdx >= 0) {
          const el = lineRefs.current[lineIdx];
          if (el) {
            el.className = lineClass(lineIdx, lineIdx);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        // Reset all word classes on previous line.
        if (useWords && prev.line >= 0 && wordRefs.current[prev.line]) {
          for (const w of wordRefs.current[prev.line]) w.className = 'lyrics-word';
        }
      }

      // Update word classes inside the active line.
      if (useWords && lineIdx >= 0 && wordRefs.current[lineIdx]) {
        const ws = wordRefs.current[lineIdx];
        for (let j = 0; j < ws.length; j++) {
          ws[j].className = j < wordIdx ? 'lyrics-word played'
                          : j === wordIdx ? 'lyrics-word active'
                          : 'lyrics-word';
        }
      }

      prevActive.current = { line: lineIdx, word: wordIdx };
    };

    // Prime once from the current store value.
    apply(usePlayerStore.getState().currentTime);
    const unsub = usePlayerStore.subscribe(s => apply(s.currentTime));
    return unsub;
  }, [useWords, hasSynced, wordLines, syncedLines]);

  if (!currentTrack) {
    return (
      <div className="lyrics-pane-empty">
        <p className="lyrics-status">{t('player.lyricsNotFound')}</p>
      </div>
    );
  }

  const sourceLabel = source === 'server'
    ? t('player.lyricsSourceServer')
    : source === 'lrclib'
      ? t('player.lyricsSourceLrclib')
      : source === 'netease'
        ? t('player.lyricsSourceNetease')
        : source === 'lyricsplus'
          ? t('player.lyricsSourceLyricsplus')
          : null;

  // Static-only + synced or words available → render line list as static text.
  const renderAsStatic = staticOnly && (
    (syncedLines !== null && syncedLines.length > 0) ||
    (wordLines !== null && wordLines.length > 0)
  );

  return (
    <div className="lyrics-pane">
      {loading && <p className="lyrics-status">{t('player.lyricsLoading')}</p>}
      {notFound && !loading && <p className="lyrics-status">{t('player.lyricsNotFound')}</p>}

      {useWords && (
        <div className="lyrics-synced lyrics-word-synced">
          {(wordLines as WordLyricsLine[]).map((line, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className="lyrics-line"
              onClick={() => { if (duration > 0) seek(line.time / duration); }}
              style={{ cursor: 'pointer' }}
            >
              {line.words.length > 0 ? line.words.map((w, j) => (
                <span
                  key={j}
                  className="lyrics-word"
                  ref={el => {
                    if (!wordRefs.current[i]) wordRefs.current[i] = [];
                    if (el) wordRefs.current[i][j] = el;
                  }}
                >
                  {w.text}
                </span>
              )) : (line.text || '\u00A0')}
            </div>
          ))}
        </div>
      )}

      {hasSynced && !useWords && (
        <div className="lyrics-synced">
          {(syncedLines as LrcLine[]).map((line, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className="lyrics-line"
              onClick={() => { if (duration > 0) seek(line.time / duration); }}
              style={{ cursor: 'pointer' }}
            >
              {line.text || '\u00A0'}
            </div>
          ))}
        </div>
      )}

      {renderAsStatic && (
        <div className="lyrics-plain">
          {((syncedLines ?? []).length > 0
            ? (syncedLines as LrcLine[]).map(l => l.text)
            : (wordLines as WordLyricsLine[]).map(l => l.text)
          ).map((text, i) => (
            <p key={i} className="lyrics-plain-line">{text || '\u00A0'}</p>
          ))}
        </div>
      )}

      {!renderAsStatic && !useWords && !hasSynced && plainLyrics && (
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

function lineClass(i: number, active: number): string {
  const base = 'lyrics-line';
  if (i > active) return base;
  if (i < active) return `${base} completed`;
  return `${base} active`;
}
