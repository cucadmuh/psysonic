import { invoke } from '@tauri-apps/api/core';
import { buildStreamUrl } from './api/subsonic';
import { useAuthStore } from './store/authStore';
import { useHotCacheStore } from './store/hotCacheStore';
import { useOfflineStore } from './store/offlineStore';
import { usePlayerStore } from './store/playerStore';
import { getDeferHotCachePrefetch } from './utils/hotCacheGate';

const PREFETCH_AHEAD = 5;

type PrefetchJob = { trackId: string; serverId: string; suffix: string };

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingQueue: PrefetchJob[] = [];
let workerRunning = false;

function debounceMs(): number {
  const s = useAuthStore.getState().hotCacheDebounceSec;
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(600, s) * 1000;
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

      const { queue, queueIndex } = usePlayerStore.getState();
      const wantIds = new Set(
        queue
          .slice(queueIndex + 1, queueIndex + 1 + PREFETCH_AHEAD)
          .map(t => t.id),
      );
      if (!wantIds.has(job.trackId)) continue;

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
        await useHotCacheStore.getState().evictToFit(
          fresh.queue,
          fresh.queueIndex,
          maxBytes,
          auth.activeServerId,
          customDir,
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

function entryKey(serverId: string, trackId: string): string {
  return `${serverId}:${trackId}`;
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
  const jobs: PrefetchJob[] = [];
  for (const t of targets) {
    if (offline.isDownloaded(t.id, serverId)) continue;
    if (hot.entries[entryKey(serverId, t.id)]) continue;
    jobs.push({
      trackId: t.id,
      serverId,
      suffix: t.suffix || 'mp3',
    });
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
    const onlyIndexMoved = q === lastQueueRef && i !== lastQueueIndex;
    lastQueueRef = q;
    lastQueueIndex = i;
    if (onlyIndexMoved) void replanNow();
    else scheduleReplan();
  });

  let lastAuthSig = '';
  const unsubAuth = useAuthStore.subscribe(state => {
    const sig = `${state.hotCacheEnabled}:${state.hotCacheDebounceSec}:${state.hotCacheMaxMb}:${state.hotCacheDownloadDir ?? ''}:${state.activeServerId ?? ''}:${state.isLoggedIn}`;
    if (sig === lastAuthSig) return;
    lastAuthSig = sig;
    if (state.hotCacheEnabled && state.isLoggedIn) scheduleReplan();
  });

  void replanNow();

  return () => {
    unsubPlayer();
    unsubAuth();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    pendingQueue.length = 0;
  };
}
