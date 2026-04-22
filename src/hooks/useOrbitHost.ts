import { useEffect, useRef } from 'react';
import { useOrbitStore } from '../store/orbitStore';
import { usePlayerStore } from '../store/playerStore';
import {
  writeOrbitState,
  writeOrbitHeartbeat,
  sweepGuestOutboxes,
  applyOutboxSnapshotsToState,
} from '../utils/orbit';
import { orbitOutboxPlaylistName, type OrbitState } from '../api/orbit';

/**
 * Orbit — host-side tick hook.
 *
 * Mounted once at the app shell level; only does work when the local store
 * says we're the host of an active session. Two independent timers:
 *
 *   - **State tick** (2.5 s): snapshot isPlaying + position + current track
 *     from the player store, patch the local OrbitState, push to the
 *     session playlist's comment.
 *   - **Heartbeat tick** (10 s): refresh the host's own outbox playlist's
 *     comment with a fresh timestamp so the later-added participant
 *     pipeline can treat the host symmetrically.
 *
 * Writes are best-effort — a transient Navidrome outage just means guests
 * see stale state for a tick or two and catch up on the next write.
 * Phase 2 does not yet consume anything from guests.
 */

const STATE_TICK_MS     = 2_500;
const HEARTBEAT_TICK_MS = 10_000;

export function useOrbitHost(): void {
  const role              = useOrbitStore(s => s.role);
  const phase             = useOrbitStore(s => s.phase);
  const sessionPlaylistId = useOrbitStore(s => s.sessionPlaylistId);
  const outboxPlaylistId  = useOrbitStore(s => s.outboxPlaylistId);
  const sessionId         = useOrbitStore(s => s.sessionId);

  // Refs hold the last values we used to build the patch — cheap to
  // recompute against, no need to subscribe to every playerStore tick.
  const lastPushedAtRef = useRef(0);

  const active = role === 'host' && phase === 'active' && !!sessionPlaylistId;

  useEffect(() => {
    if (!active || !sessionPlaylistId) return;

    const snapshotPlayerPatch = (hostUsername: string): Partial<OrbitState> => {
      const p = usePlayerStore.getState();
      const now = Date.now();
      return {
        isPlaying: p.isPlaying,
        positionMs: Math.round((p.currentTime ?? 0) * 1000),
        positionAt: now,
        currentTrack: p.currentTrack
          ? {
              trackId: p.currentTrack.id,
              // Locally-initiated plays are marked as authored by the host.
              // Guest-suggested tracks that later become `currentTrack` will
              // carry their original attribution because the queue-consume
              // flow keeps the `addedBy` from the guest's outbox.
              addedBy: hostUsername,
              addedAt: now,
            }
          : null,
      };
    };

    const pushState = async () => {
      const store = useOrbitStore.getState();
      const base = store.state;
      if (!base) return;

      // 1) Sweep every guest outbox: new suggestions + fresh heartbeats.
      let afterSweep = base;
      try {
        const snaps = await sweepGuestOutboxes(base.sid, base.host);
        afterSweep = applyOutboxSnapshotsToState(base, snaps);
      } catch { /* best-effort; keep old participants and queue */ }

      // 2) Overlay the host's live playback snapshot.
      const next: OrbitState = { ...afterSweep, ...snapshotPlayerPatch(base.host) };

      // 3) Commit locally + push remote.
      useOrbitStore.getState().setState(next);
      try {
        await writeOrbitState(sessionPlaylistId, next);
        lastPushedAtRef.current = Date.now();
      } catch { /* best-effort; next tick retries */ }
    };

    // Immediate push on mount so guests see fresh state without waiting
    // a full tick after the host comes online.
    void pushState();

    const id = window.setInterval(() => { void pushState(); }, STATE_TICK_MS);
    return () => window.clearInterval(id);
  }, [active, sessionPlaylistId]);

  useEffect(() => {
    if (!active || !outboxPlaylistId || !sessionId) return;
    const server = useOrbitStore.getState().state?.host;
    if (!server) return;
    const outboxName = orbitOutboxPlaylistName(sessionId, server);

    const pushHeartbeat = async () => {
      try { await writeOrbitHeartbeat(outboxPlaylistId, outboxName); }
      catch { /* best-effort */ }
    };
    void pushHeartbeat();

    const id = window.setInterval(() => { void pushHeartbeat(); }, HEARTBEAT_TICK_MS);
    return () => window.clearInterval(id);
  }, [active, outboxPlaylistId, sessionId]);
}
