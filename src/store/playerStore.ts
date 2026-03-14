import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Howl } from 'howler';
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
  buffered: number; // 0–1
  currentTime: number;
  volume: number;
  howl: Howl | null;
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
//
// Kept outside Zustand to avoid stale-closure / React re-render races.
//
// activeHowl  – the one and only live Howl; all event handlers reference this.
// playGeneration – monotonically incremented on every playTrack() call.
//   Every Howl event callback captures its own `gen` value at creation time
//   and bails out immediately if playGeneration has moved on. This prevents
//   stale onend / onplay callbacks from a superseded Howl from affecting state.

let activeHowl: Howl | null = null;
let playGeneration = 0;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let seekDebounce: ReturnType<typeof setTimeout> | null = null;
let resumeFromTime: number | null = null; // cold-start resume position (app relaunch)
let lastSeekAt = 0; // timestamp (ms) of the most recent seek — used to ignore spurious 'ended' events
let togglePlayLock = false; // prevents rapid double-click from sending pause→play before GStreamer settles

function clearProgress() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// Remove all Howler-level listeners BEFORE stopping/unloading.
// This is the critical step that prevents stale `onend` callbacks from firing
// on a superseded Howl and triggering an unwanted next() / skip.
function destroyHowl(howl: Howl | null) {
  if (!howl) return;
  howl.off();     // remove all Howler event listeners
  howl.stop();    // stop any playing sound
  howl.unload();  // release the <audio> element and all resources
}

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
      howl: null,
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
        destroyHowl(activeHowl);
        activeHowl = null;
        clearProgress();
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }
        set({ isPlaying: false, progress: 0, buffered: 0, currentTime: 0, howl: null });
      },

      // ── playTrack ────────────────────────────────────────────────────────────
      playTrack: (track, queue) => {
        // Claim a new generation. Every callback created below captures `gen`.
        // If playTrack() is called again before these callbacks fire, gen will
        // no longer match playGeneration and the callbacks silently return.
        const gen = ++playGeneration;

        // Fully destroy the previous Howl — listeners first, then audio resources.
        destroyHowl(activeHowl);
        activeHowl = null;
        clearProgress();
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }

        const state = get();
        const newQueue = queue ?? state.queue;
        const idx = newQueue.findIndex(t => t.id === track.id);

        const howl = new Howl({
          src: [buildStreamUrl(track.id)],
          html5: true,
          volume: state.volume,
        });
        activeHowl = howl;

        // Commit state BEFORE howl.play() so queueIndex / currentTrack are
        // already correct when the onplay / onend callbacks fire.
        set({
          currentTrack: track,
          queue: newQueue,
          queueIndex: idx >= 0 ? idx : 0,
          howl,
          progress: 0,
          buffered: 0,
          currentTime: 0,
          scrobbled: false,
        });

        howl.on('play', () => {
          if (playGeneration !== gen) return;
          set({ isPlaying: true });
          reportNowPlaying(track.id);

          // Cold-start resume: seek to the position that was saved before the
          // app was closed. A short delay lets the audio pipeline stabilise.
          if (resumeFromTime !== null) {
            const t = resumeFromTime;
            resumeFromTime = null;
            setTimeout(() => {
              if (playGeneration === gen) activeHowl?.seek(t);
            }, 80);
          }

          clearProgress(); // guard against duplicate onplay
          progressInterval = setInterval(() => {
            // Bail out if this interval belongs to a superseded generation
            if (playGeneration !== gen) { clearProgress(); return; }
            const h = activeHowl;
            if (!h) return;

            const raw = h.seek();
            const cur = typeof raw === 'number' ? raw : 0;
            const dur = h.duration() || 1;

            // Buffered indicator via underlying <audio> element
            const audioNode = (h as any)._sounds?.[0]?._node as HTMLAudioElement | undefined;
            if (audioNode?.buffered && audioNode.duration > 0) {
              let totalBuf = 0;
              for (let i = 0; i < audioNode.buffered.length; i++) {
                totalBuf += audioNode.buffered.end(i) - audioNode.buffered.start(i);
              }
              set({ currentTime: cur, progress: cur / dur, buffered: Math.min(1, totalBuf / audioNode.duration) });
            } else {
              set({ currentTime: cur, progress: cur / dur });
            }

            // Scrobble at 50%
            if (cur / dur >= 0.5 && !get().scrobbled) {
              set({ scrobbled: true });
              const { scrobblingEnabled } = useAuthStore.getState();
              if (scrobblingEnabled) scrobbleSong(track.id, Date.now());
            }
          }, 500);
        });

        howl.on('end', () => {
          if (playGeneration !== gen) return;
          // WebKit (and GStreamer on Linux) can fire spurious 'ended' events
          // immediately after a direct audioNode.currentTime seek. Guard: if we
          // are within 1 s of the last seek AND the playhead is not actually near
          // the track end, treat this as a false alarm and ignore it.
          if (Date.now() - lastSeekAt < 1000) {
            const audioNode = (activeHowl as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
            const pos = audioNode ? audioNode.currentTime : (typeof activeHowl?.seek() === 'number' ? activeHowl.seek() as number : 0);
            const dur = activeHowl?.duration() ?? 0;
            if (dur > 0 && pos < dur - 1) return;
          }
          clearProgress();
          set({ isPlaying: false, progress: 0, buffered: 0, currentTime: 0 });
          const { repeatMode, currentTrack, queue: q } = get();
          if (repeatMode === 'one' && currentTrack) {
            get().playTrack(currentTrack, q);
          } else {
            get().next();
          }
        });

        howl.on('playerror', (_, err) => {
          if (playGeneration !== gen) return;
          console.error('Howl play error:', err);
          clearProgress();
          set({ isPlaying: false });
        });

        howl.play();
        syncQueueToServer(newQueue, track, 0);
      },

      // ── pause / resume / togglePlay ──────────────────────────────────────────
      pause: () => {
        activeHowl?.pause();
        clearProgress();
        set({ isPlaying: false });
      },

      resume: () => {
        const { currentTrack, queue, currentTime } = get();
        if (!currentTrack) return;
        if (activeHowl) {
          activeHowl.play();
          set({ isPlaying: true });
          return;
        }
        // Cold start after app relaunch — Howl was not persisted.
        resumeFromTime = currentTime > 0 ? currentTime : null;
        get().playTrack(currentTrack, queue);
      },

      togglePlay: () => {
        // Guard: rapid double-clicks send pause→play (or play→pause) before
        // GStreamer/WebKit has finished the previous state transition, causing
        // the audio pipeline to hang for several seconds. Ignore the second
        // click if it arrives within 300 ms of the first.
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
          // End of queue — clean stop without destroying currentTrack metadata
          destroyHowl(activeHowl);
          activeHowl = null;
          clearProgress();
          set({ isPlaying: false, progress: 0, buffered: 0, currentTime: 0, howl: null });
        }
      },

      previous: () => {
        const { queue, queueIndex, currentTime } = get();
        if (currentTime > 3) {
          activeHowl?.seek(0);
          set({ progress: 0, currentTime: 0 });
          return;
        }
        const prevIdx = queueIndex - 1;
        if (prevIdx >= 0) get().playTrack(queue[prevIdx], queue);
      },

      // ── seek ─────────────────────────────────────────────────────────────────
      // Debounced 100 ms to collapse rapid slider drags into one actual seek.
      // We bypass Howler's seek() entirely and set currentTime directly on the
      // underlying <audio> element. Howler's seek() internally calls pause() +
      // play() which can fire spurious ended/stop events on some WebKit versions,
      // especially on the second consecutive seek.
      seek: (progress) => {
        const { currentTrack } = get();
        if (!activeHowl || !currentTrack) return;
        const dur = activeHowl.duration() || currentTrack.duration;
        if (!dur || !isFinite(dur)) return;
        // Clamp slightly before end to prevent accidentally triggering 'ended'
        const time = Math.max(0, Math.min(progress * dur, dur - 0.25));
        set({ progress: time / dur, currentTime: time });
        lastSeekAt = Date.now();
        if (seekDebounce) clearTimeout(seekDebounce);
        seekDebounce = setTimeout(() => {
          seekDebounce = null;
          const audioNode = (activeHowl as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
          if (audioNode && isFinite(time)) {
            audioNode.currentTime = time;
          } else {
            activeHowl?.seek(time);
          }
        }, 100);
      },

      // ── volume ───────────────────────────────────────────────────────────────
      setVolume: (v) => {
        const clamped = Math.max(0, Math.min(1, v));
        activeHowl?.volume(clamped);
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
        destroyHowl(activeHowl);
        activeHowl = null;
        clearProgress();
        if (seekDebounce) { clearTimeout(seekDebounce); seekDebounce = null; }
        set({ queue: [], queueIndex: 0, currentTrack: null, isPlaying: false, progress: 0, buffered: 0, currentTime: 0, howl: null });
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

            set({
              queue: mappedTracks,
              queueIndex,
              currentTrack,
              currentTime: q.position ? q.position / 1000 : 0,
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
      } as Partial<PlayerState>),
    }
  )
);
