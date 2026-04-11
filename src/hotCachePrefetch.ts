import { invoke } from '@tauri-apps/api/core';
import { buildStreamUrl } from './api/subsonic';
import { useAuthStore } from './store/authStore';
import { HOT_CACHE_PROTECT_AFTER_CURRENT, useHotCacheStore, type HotCacheEntry } from './store/hotCacheStore';
import { useOfflineStore } from './store/offlineStore';
import { usePlayerStore, type Track } from './store/playerStore';
import {
  bumpHotCachePreviousTrackGrace,
  clearHotCachePreviousGrace,
  getDeferHotCachePrefetch,
} from './utils/hotCacheGate';

/** How many upcoming queue tracks may be prefetched (only current + next are eviction-protected). */
const PREFETCH_AHEAD = 5;

function entryKey(serverId: string, trackId: string): string {
  return `${serverId}:${trackId}`;
}

/** Sum of on-disk bytes for eviction-protected slots (current + next — same span as `evictToFit`). */
function sumCachedBytesInProtectedWindow(
  queue: Track[],
  queueIndex: number,
  serverId: string,
  entries: Record<string, HotCacheEntry>,
): number {
  const protectLo = Math.max(0, queueIndex);
  const protectHi = Math.min(queue.length - 1, queueIndex + HOT_CACHE_PROTECT_AFTER_CURRENT);
  let sum = 0;
  for (let i = protectLo; i <= protectHi; i++) {
    const e = entries[entryKey(serverId, queue[i].id)];
    if (e) sum += e.sizeBytes || 0;
  }
  return sum;
}

/** Conservative size guess so we do not prefetch when the protected window could exceed the cap. */
function estimateTrackHotCacheBytes(track: Track): number {
  const sz = track.size;
  if (typeof sz === 'number' && Number.isFinite(sz) && sz > 0) {
    return Math.ceil(sz * 1.06);
  }
  const dur =
    typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 240;
  const sfx = (track.suffix || '').toLowerCase();
  const lossless = /^(flac|wav|dsf|dff|alac|ape|wv)$/.test(sfx);
  let kbps =
    typeof track.bitRate === 'number' && Number.isFinite(track.bitRate) && track.bitRate > 0
      ? track.bitRate
      : 320;
  if (lossless && kbps < 800) {
    kbps = Math.max(kbps, 900);
  }
  const raw = Math.ceil((dur * kbps * 1000) / 8);
  return Math.max(256 * 1024, Math.ceil(raw * (lossless ? 1.2 : 1.15)));
}

type PrefetchJob = { trackId: string; serverId: string; suffix: string };

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Fires `replanNow` once grace for the ex-current track ends so eviction can drop it. */
let graceEvictTimer: ReturnType<typeof setTimeout> | null = null;
const pendingQueue: PrefetchJob[] = [];
let workerRunning = false;

function debounceMs(): number {
  const s = useAuthStore.getState().hotCacheDebounceSec;
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(600, s) * 1000;
}

function scheduleEvictAfterPreviousGrace(): void {
  if (graceEvictTimer) {
    clearTimeout(graceEvictTimer);
    graceEvictTimer = null;
  }
  const ms = debounceMs();
  if (ms <= 0) {
    void replanNow();
    return;
  }
  graceEvictTimer = setTimeout(() => {
    graceEvictTimer = null;
    void replanNow();
  }, ms);
}

function enqueueJobs(jobs: PrefetchJob[]) {
  const seen = new Set(pendingQueue.map(j => `${j.serverId}:${j.trackId}`));
  for (const j of jobs) {
    const k = `${j.serverId}:${j.trackId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pendingQueue.push(j);
  }
  void runWorker();
}

async function runWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (pendingQueue.length > 0) {
      const auth = useAuthStore.getState();
      if (!auth.isLoggedIn || !auth.hotCacheEnabled || !auth.activeServerId) {
        pendingQueue.length = 0;
        break;
      }

      while (getDeferHotCachePrefetch()) {
        await new Promise(r => setTimeout(r, 150));
      }

      const job = pendingQueue.shift();
      if (!job) break;

      const maxBytes = Math.max(0, auth.hotCacheMaxMb) * 1024 * 1024;
      if (maxBytes <= 0) continue;

      const offline = useOfflineStore.getState();
      if (offline.isDownloaded(job.trackId, job.serverId)) continue;
      if (useHotCacheStore.getState().entries[entryKey(job.serverId, job.trackId)]) continue;

      const player = usePlayerStore.getState();
      const { queue, queueIndex } = player;
      const wantIds = new Set(
        queue
          .slice(queueIndex + 1, queueIndex + 1 + PREFETCH_AHEAD)
          .map(t => t.id),
      );
      if (!wantIds.has(job.trackId)) continue;

      const track = queue.find(t => t.id === job.trackId);
      if (!track) continue;
      const hotEntries = useHotCacheStore.getState().entries;
      const occupied = sumCachedBytesInProtectedWindow(queue, queueIndex, job.serverId, hotEntries);
      const est = estimateTrackHotCacheBytes(track);
      const isImmediateNext = queue[queueIndex + 1]?.id === job.trackId;
      if (!isImmediateNext && occupied + est > maxBytes) continue;

      const url = buildStreamUrl(job.trackId);
      try {
        const customDir = auth.hotCacheDownloadDir || null;
        const res = await invoke<{ path: string; size: number }>('download_track_hot_cache', {
          trackId: job.trackId,
          serverId: job.serverId,
          url,
          suffix: job.suffix,
          customDir,
        });
        useHotCacheStore.getState().setEntry(job.trackId, job.serverId, res.path, res.size);
        const fresh = usePlayerStore.getState();
        const authAfter = useAuthStore.getState();
        const maxAfter = Math.max(0, authAfter.hotCacheMaxMb) * 1024 * 1024;
        await useHotCacheStore.getState().evictToFit(
          fresh.queue,
          fresh.queueIndex,
          maxAfter,
          authAfter.activeServerId ?? '',
          authAfter.hotCacheDownloadDir || null,
        );
      } catch {
        /* network / HTTP — skip */
      }
    }
  } finally {
    workerRunning = false;
    if (pendingQueue.length > 0) void runWorker();
  }
}

function scheduleReplan() {
  const auth = useAuthStore.getState();
  if (!auth.isLoggedIn || !auth.hotCacheEnabled || !auth.activeServerId) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  const ms = debounceMs();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void replanNow();
  }, ms);
}

async function replanNow() {
  const auth = useAuthStore.getState();
  if (!auth.isLoggedIn || !auth.hotCacheEnabled || !auth.activeServerId) return;

  const serverId = auth.activeServerId;
  const maxBytes = Math.max(0, auth.hotCacheMaxMb) * 1024 * 1024;
  const customDir = auth.hotCacheDownloadDir || null;
  if (maxBytes <= 0) return;

  const { queue, queueIndex, currentRadio } = usePlayerStore.getState();
  if (currentRadio) return;

  const offline = useOfflineStore.getState();
  const hot = useHotCacheStore.getState();

  await hot.evictToFit(queue, queueIndex, maxBytes, serverId, customDir);

  const targets = queue.slice(queueIndex + 1, queueIndex + 1 + PREFETCH_AHEAD);
  const immediateNextId = queue[queueIndex + 1]?.id;
  let projectedOccupied = sumCachedBytesInProtectedWindow(queue, queueIndex, serverId, hot.entries);
  const jobs: PrefetchJob[] = [];
  for (const t of targets) {
    if (offline.isDownloaded(t.id, serverId)) continue;
    if (hot.entries[entryKey(serverId, t.id)]) continue;
    const isImmediateNext = t.id === immediateNextId;
    if (isImmediateNext) {
      jobs.push({ trackId: t.id, serverId, suffix: t.suffix || 'mp3' });
      continue;
    }
    const est = estimateTrackHotCacheBytes(t);
    if (projectedOccupied + est > maxBytes) break;
    projectedOccupied += est;
    jobs.push({ trackId: t.id, serverId, suffix: t.suffix || 'mp3' });
  }
  enqueueJobs(jobs);
}

/**
 * Subscribe to queue/auth changes and run debounced prefetch.
 * Call once from the app shell.
 */
export function initHotCachePrefetch(): () => void {
  let lastQueueRef: unknown = null;
  let lastQueueIndex = -1;
  const unsubPlayer = usePlayerStore.subscribe(state => {
    const q = state.queue;
    const i = state.queueIndex;
    if (q === lastQueueRef && i === lastQueueIndex) return;
    const prevIdx = lastQueueIndex;
    const prevQ = lastQueueRef;
    const onlyIndexMoved = q === lastQueueRef && i !== lastQueueIndex;
    lastQueueRef = q;
    lastQueueIndex = i;
    if (onlyIndexMoved && i > prevIdx && prevIdx >= 0 && Array.isArray(prevQ)) {
      const left = (prevQ as Track[])[prevIdx];
      const a = useAuthStore.getState();
      if (left && a.activeServerId) {
        bumpHotCachePreviousTrackGrace(left.id, a.activeServerId, a.hotCacheDebounceSec);
        scheduleEvictAfterPreviousGrace();
      }
    }
    if (onlyIndexMoved) void replanNow();
    else scheduleReplan();
  });

  let lastAuthSig = '';
  const unsubAuth = useAuthStore.subscribe((state, prev) => {
    const sig = `${state.hotCacheEnabled}:${state.hotCacheDebounceSec}:${state.hotCacheMaxMb}:${state.hotCacheDownloadDir ?? ''}:${state.activeServerId ?? ''}:${state.isLoggedIn}`;
    if (sig === lastAuthSig) return;
    lastAuthSig = sig;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (!state.hotCacheEnabled || !state.isLoggedIn) {
      pendingQueue.length = 0;
      clearHotCachePreviousGrace();
      return;
    }

    const budgetSettingsChanged =
      !prev ||
      state.hotCacheMaxMb !== prev.hotCacheMaxMb ||
      state.hotCacheDownloadDir !== prev.hotCacheDownloadDir ||
      state.hotCacheEnabled !== prev.hotCacheEnabled ||
      state.activeServerId !== prev.activeServerId ||
      state.isLoggedIn !== prev.isLoggedIn;

    const onlyDebounceChanged =
      !!prev &&
      state.hotCacheDebounceSec !== prev.hotCacheDebounceSec &&
      !budgetSettingsChanged;

    if (budgetSettingsChanged) {
      if (prev && state.hotCacheMaxMb < prev.hotCacheMaxMb) {
        pendingQueue.length = 0;
      }
      void replanNow();
    } else if (onlyDebounceChanged) {
      scheduleReplan();
    }
  });

  void replanNow();

  return () => {
    unsubPlayer();
    unsubAuth();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    if (graceEvictTimer) clearTimeout(graceEvictTimer);
    graceEvictTimer = null;
    pendingQueue.length = 0;
    clearHotCachePreviousGrace();
  };
}
