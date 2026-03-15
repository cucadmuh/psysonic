import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { buildStreamUrl, getPlayQueue, savePlayQueue, SubsonicSong, reportNowPlaying, scrobbleSong } from '../api/subsonic';
import { useAuthStore } from './authStore';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  artistId?: string;
  duration: number;
  coverArt?: string;
  track?: number;
  year?: number;
  bitRate?: number;
  suffix?: string;
  userRating?: number;
}

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  isPlaying: boolean;
  progress: number; // 0–1
  buffered: number; // 0–1 (unused in Rust backend, kept for UI compat)
  currentTime: number;
  volume: number;
  scrobbled: boolean;

  playTrack: (track: Track, queue?: Track[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (progress: number) => void;
  setVolume: (v: number) => void;
  setProgress: (t: number, duration: number) => void;
  enqueue: (tracks: Track[]) => void;
  clearQueue: () => void;

  isQueueVisible: boolean;
  toggleQueue: () => void;

  isFullscreenOpen: boolean;
  toggleFullscreen: () => void;

  repeatMode: 'off' | 'all' | 'one';
  toggleRepeat: () => void;

  reorderQueue: (startIndex: number, endIndex: number) => void;
  removeTrack: (index: number) => void;
  shuffleQueue: () => void;

  initializeFromServerQueue: () => Promise<void>;

  contextMenu: {
    isOpen: boolean;
    x: number;
    y: number;
    item: any;
    type: 'song' | 'album' | 'artist' | 'queue-item' | 'album-song' | null;
    queueIndex?: number;
  };
  openContextMenu: (x: number, y: number, item: any, type: 'song' | 'album' | 'artist' | 'queue-item' | 'album-song', queueIndex?: number) => void;
  closeContextMenu: () => void;
}

// ─── Module-level playback primitives ─────────────────────────────────────────

// isAudioPaused — true when the Rust audio engine has a loaded-but-paused track.
// Used by resume() to decide between audio_resume (warm) vs audio_play (cold start).
let isAudioPaused = false;

// JS-side generation counter. Incremented on every playTrack() call.
// The invoke().catch() error handler captures its own gen and bails if
// playGeneration has moved on, preventing stale errors from skipping wrong tracks.
let playGeneration = 0;

// Debounce timer for seek slider drags.
let seekDebounce: ReturnType<typeof setTimeout> | null = null;

// Guard against rapid double-click play/pause sending two state transitions
// to the Rust backend before it has finished the previous one.
let togglePlayLock = false;

// ─── Server queue sync ─────────────────────────────────────────────────────────
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
function syncQueueToServer(queue: Track[], currentTrack: Track | null, currentTime: number) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    const ids = queue.slice(0, 1000).map(t => t.id);
    const pos = Math.floor(currentTime * 1000);
    savePlayQueue(ids, currentTrack?.id, pos).catch(err => {
      console.error('Failed to sync play queue to server', err);
    });
  }, 1500);
}

// ─── Audio event handlers (called from initAudioListeners) ───────────────────

function handleAudioPlaying(_duration: number) {
  usePlayerStore.setState({ isPlaying: true });
}

function handleAudioProgress(current_time: number, duration: number) {
  const store = usePlayerStore.getState();
  const track = store.currentTrack;
  if (!track) return;
  const dur = duration > 0 ? duration : track.duration;
  if (dur <= 0) return;
  const progress = current_time / dur;
  usePlayerStore.setState({ currentTime: current_time, progress, buffered: 0 });

  // Scrobble at 50%
  if (progress >= 0.5 && !store.scrobbled) {
    usePlayerStore.setState({ scrobbled: true });
    const { scrobblingEnabled } = useAuthStore.getState();
    if (scrobblingEnabled) scrobbleSong(track.id, Date.now());
  }
}

function handleAudioEnded() {
  const { repeatMode, currentTrack, queue } = usePlayerStore.getState();
  isAudioPaused = false;
  usePlayerStore.setState({ isPlaying: false, progress: 0, currentTime: 0, buffered: 0 });
  setTimeout(() => {
    if (repeatMode === 'one' && currentTrack) {
      usePlayerStore.getState().playTrack(currentTrack, queue);
    } else {
      usePlayerStore.getState().next();
    }
  }, 150);
}

function handleAudioError(message: string) {
  console.error('[psysonic] Audio error from backend:', message);
  isAudioPaused = false;
  const gen = playGeneration;
  usePlayerStore.setState({ isPlaying: false });
  setTimeout(() => {
    if (playGeneration !== gen) return;
    usePlayerStore.getState().next();
  }, 500);
}

/**
 * Set up Tauri event listeners for the Rust audio engine.
 * Returns a cleanup function — pass it to useEffect's return value so that
 * React StrictMode (which double-invokes effects in dev) tears down the first
 * set of listeners before creating the second, avoiding duplicate handlers.
 */
export function initAudioListeners(): () => void {
  const pending = [
    listen<number>('audio:playing', ({ payload }) => handleAudioPlaying(payload)),
    listen<{ current_time: number; duration: number }>('audio:progress', ({ payload }) =>
      handleAudioProgress(payload.current_time, payload.duration)
    ),
    listen<void>('audio:ended', () => handleAudioEnded()),
    listen<string>('audio:error', ({ payload }) => handleAudioError(payload)),
  ];

  return () => {
    pending.forEach(p => p.then(unlisten => unlisten()));
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      progress: 0,
      buffered: 0,
      currentTime: 0,
      volume: 0.8,
      scrobbled: false,
      isQueueVisible: true,
      isFullscreenOpen: false,
      repeatMode: 'off',
      contextMenu: { isOpen: false, x: 0, y: 0, item: null, type: null },

      openContextMenu: (x, y, item, type, queueIndex) => set({
        contextMenu: { isOpen: true, x, y, item, type, queueIndex },
      }),
      closeContextMenu: () => set(state => ({
        contextMenu: { ...state.contextMenu, isOpen: false },
      })),

      toggleQueue: () => set(state => ({ isQueueVisible: !state.isQueueVisible })),
      toggleFullscreen: () => set(state => ({ isFullscreenOpen: !state.isFullscreenOpen })),

      toggleRepeat: () => set(state => {
        const modes = ['off', 'all', 'one'] as const;
        return { repeatMode: modes[(modes.indexOf(state.repeatMode) + 1) % modes.length] };
      }),

      // ── stop ────────────────────────────────────────────────────────────────
      stop: () => {
        invoke('audio_stop').catch(console.error);
        isAudioPaused = false;
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }
        set({ isPlaying: false, progress: 0, buffered: 0, currentTime: 0 });
      },

      // ── playTrack ────────────────────────────────────────────────────────────
      playTrack: (track, queue) => {
        const gen = ++playGeneration;
        isAudioPaused = false;
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }

        const state = get();
        const newQueue = queue ?? state.queue;
        const idx = newQueue.findIndex(t => t.id === track.id);

        // Set state immediately so the UI updates before the download completes.
        set({
          currentTrack: track,
          queue: newQueue,
          queueIndex: idx >= 0 ? idx : 0,
          progress: 0,
          buffered: 0,
          currentTime: 0,
          scrobbled: false,
          isPlaying: true, // optimistic — reverted on error
        });

        const url = buildStreamUrl(track.id);
        invoke('audio_play', {
          url,
          volume: state.volume,
          durationHint: track.duration,
        }).catch((err: unknown) => {
          if (playGeneration !== gen) return;
          console.error('[psysonic] audio_play failed:', err);
          set({ isPlaying: false });
          setTimeout(() => {
            if (playGeneration !== gen) return;
            get().next();
          }, 500);
        });

        reportNowPlaying(track.id);
        syncQueueToServer(newQueue, track, 0);
      },

      // ── pause / resume / togglePlay ──────────────────────────────────────────
      pause: () => {
        invoke('audio_pause').catch(console.error);
        isAudioPaused = true;
        set({ isPlaying: false });
      },

      resume: () => {
        const { currentTrack, queue, currentTime } = get();
        if (!currentTrack) return;

        if (isAudioPaused) {
          // Rust engine has audio loaded but paused — just resume it.
          invoke('audio_resume').catch(console.error);
          isAudioPaused = false;
          set({ isPlaying: true });
        } else {
          // Cold start (app relaunch) — audio is not loaded in Rust; re-download.
          const gen = ++playGeneration;
          const vol = get().volume;
          set({ isPlaying: true });
          invoke('audio_play', {
            url: buildStreamUrl(currentTrack.id),
            volume: vol,
            durationHint: currentTrack.duration,
          }).then(() => {
            if (playGeneration === gen && currentTime > 1) {
              invoke('audio_seek', { seconds: currentTime }).catch(console.error);
            }
          }).catch((err: unknown) => {
            if (playGeneration !== gen) return;
            console.error('[psysonic] audio_play (cold resume) failed:', err);
            set({ isPlaying: false });
          });
          syncQueueToServer(queue, currentTrack, currentTime);
        }
      },

      togglePlay: () => {
        if (togglePlayLock) return;
        togglePlayLock = true;
        setTimeout(() => { togglePlayLock = false; }, 300);
        const { isPlaying } = get();
        isPlaying ? get().pause() : get().resume();
      },

      // ── next / previous ──────────────────────────────────────────────────────
      next: () => {
        const { queue, queueIndex, repeatMode } = get();
        const nextIdx = queueIndex + 1;
        if (nextIdx < queue.length) {
          get().playTrack(queue[nextIdx], queue);
        } else if (repeatMode === 'all' && queue.length > 0) {
          get().playTrack(queue[0], queue);
        } else {
          invoke('audio_stop').catch(console.error);
          isAudioPaused = false;
          set({ isPlaying: false, progress: 0, buffered: 0, currentTime: 0 });
        }
      },

      previous: () => {
        const { queue, queueIndex, currentTime } = get();
        if (currentTime > 3) {
          // Restart current track from the beginning.
          invoke('audio_seek', { seconds: 0 }).catch(console.error);
          set({ progress: 0, currentTime: 0 });
          return;
        }
        const prevIdx = queueIndex - 1;
        if (prevIdx >= 0) get().playTrack(queue[prevIdx], queue);
      },

      // ── seek ─────────────────────────────────────────────────────────────────
      // 100 ms debounce collapses rapid slider drags into one actual seek.
      seek: (progress) => {
        const { currentTrack } = get();
        if (!currentTrack) return;
        const dur = currentTrack.duration;
        if (!dur || !isFinite(dur)) return;
        const time = Math.max(0, Math.min(progress * dur, dur - 0.25));
        set({ progress: time / dur, currentTime: time });
        if (seekDebounce) clearTimeout(seekDebounce);
        seekDebounce = setTimeout(() => {
          seekDebounce = null;
          invoke('audio_seek', { seconds: time }).catch(console.error);
        }, 100);
      },

      // ── volume ───────────────────────────────────────────────────────────────
      setVolume: (v) => {
        const clamped = Math.max(0, Math.min(1, v));
        invoke('audio_set_volume', { volume: clamped }).catch(console.error);
        set({ volume: clamped });
      },

      setProgress: (t, duration) => {
        set({ currentTime: t, progress: duration > 0 ? t / duration : 0 });
      },

      // ── queue management ─────────────────────────────────────────────────────
      enqueue: (tracks) => {
        set(state => {
          const newQueue = [...state.queue, ...tracks];
          syncQueueToServer(newQueue, state.currentTrack, state.currentTime);
          return { queue: newQueue };
        });
      },

      clearQueue: () => {
        invoke('audio_stop').catch(console.error);
        isAudioPaused = false;
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }
        set({ queue: [], queueIndex: 0, currentTrack: null, isPlaying: false, progress: 0, buffered: 0, currentTime: 0 });
        syncQueueToServer([], null, 0);
      },

      reorderQueue: (startIndex, endIndex) => {
        const { queue, queueIndex, currentTrack } = get();
        const result = Array.from(queue);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        let newIndex = queueIndex;
        if (currentTrack) newIndex = result.findIndex(t => t.id === currentTrack.id);
        set({ queue: result, queueIndex: Math.max(0, newIndex) });
        syncQueueToServer(result, currentTrack, get().currentTime);
      },

      shuffleQueue: () => {
        const { queue, currentTrack } = get();
        if (queue.length < 2) return;
        const currentIdx = currentTrack ? queue.findIndex(t => t.id === currentTrack.id) : -1;
        const others = queue.filter((_, i) => i !== currentIdx);
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [others[i], others[j]] = [others[j], others[i]];
        }
        const result = currentIdx >= 0
          ? [queue[currentIdx], ...others]
          : others;
        const newIndex = currentIdx >= 0 ? 0 : -1;
        set({ queue: result, queueIndex: Math.max(0, newIndex) });
        syncQueueToServer(result, currentTrack, get().currentTime);
      },

      removeTrack: (index) => {
        const { queue, queueIndex } = get();
        const newQueue = [...queue];
        newQueue.splice(index, 1);
        set({ queue: newQueue, queueIndex: Math.min(queueIndex, newQueue.length - 1) });
        syncQueueToServer(newQueue, get().currentTrack, get().currentTime);
      },

      // ── server queue restore ─────────────────────────────────────────────────
      initializeFromServerQueue: async () => {
        try {
          const q = await getPlayQueue();
          if (q.songs.length > 0) {
            const mappedTracks: Track[] = q.songs.map((s: SubsonicSong) => ({
              id: s.id, title: s.title, artist: s.artist, album: s.album,
              albumId: s.albumId, artistId: s.artistId, duration: s.duration,
              coverArt: s.coverArt, track: s.track, year: s.year,
              bitRate: s.bitRate, suffix: s.suffix, userRating: s.userRating,
            }));

            let currentTrack = mappedTracks[0];
            let queueIndex = 0;

            if (q.current) {
              const idx = mappedTracks.findIndex(t => t.id === q.current);
              if (idx >= 0) { currentTrack = mappedTracks[idx]; queueIndex = idx; }
            }

            // Prefer the server position if available; otherwise keep the
            // localStorage-persisted currentTime (more reliable than server
            // queue position, which may not flush before app close).
            const serverTime = q.position ? q.position / 1000 : 0;
            const localTime = get().currentTime;
            set({
              queue: mappedTracks,
              queueIndex,
              currentTrack,
              currentTime: serverTime > 0 ? serverTime : localTime,
            });
          }
        } catch (e) {
          console.error('Failed to initialize queue from server', e);
        }
      },
    }),
    {
      name: 'psysonic-player',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        volume: state.volume,
        repeatMode: state.repeatMode,
        currentTrack: state.currentTrack,
        queue: state.queue,
        queueIndex: state.queueIndex,
        currentTime: state.currentTime,
      } as Partial<PlayerState>),
    }
  )
);
