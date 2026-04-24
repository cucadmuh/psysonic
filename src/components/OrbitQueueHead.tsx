import { useEffect, useState } from 'react';
import { Users, Wifi, WifiOff, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOrbitStore } from '../store/orbitStore';
import type { OrbitState } from '../api/orbit';

interface Props {
  state: OrbitState;
}

/** Host's state hasn't updated for this long → guest treats them as offline. */
const HOST_AWAY_THRESHOLD_MS = 15_000;

/**
 * Shared Orbit head strip rendered at the top of the queue for both host
 * and guest. Shows the session name and a comma-separated list of every
 * participant (host first, then guests in join order).
 *
 * Guest view additionally surfaces host-presence: when the host's tick
 * hasn't been seen for 15 s we render a subtle "host offline" badge so
 * the guest knows the stalled playback isn't a local problem.
 */
export default function OrbitQueueHead({ state }: Props) {
  const { t } = useTranslation();
  const role = useOrbitStore(s => s.role);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Guest-only clock tick — React wouldn't re-render a stale state blob
  // on its own, and the presence threshold is time-based.
  useEffect(() => {
    if (role !== 'guest') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, [role]);

  const names = [state.host, ...state.participants.map(p => p.user)];
  const showPresence = role === 'guest' && state.positionAt > 0;
  const hostAway = showPresence && (nowMs - state.positionAt) > HOST_AWAY_THRESHOLD_MS;
  const cap = state.settings?.maxPending ?? 0;
  // Approximate visible-pending count — same heuristic as evaluateOrbitSuggestGate.
  // Conservative for guests (over-counts declined entries) but the host's
  // own queue view sees the exact number because it has the merged/declined
  // sets locally; we don't bother surfacing the exact count here either way
  // since guests just need to know if they're near the cap.
  const pendingCount = cap > 0
    ? state.queue.filter(q => q.addedBy !== state.host).length
    : 0;

  return (
    <div className="orbit-queue-head">
      <div className="orbit-queue-head__title-row">
        <h2 className="orbit-queue-head__title">{state.name}</h2>
        {showPresence && (
          <span
            className={`orbit-queue-head__presence orbit-queue-head__presence--${hostAway ? 'away' : 'online'}`}
            role="status"
          >
            {hostAway ? <WifiOff size={11} /> : <Wifi size={11} />}
            <span>{t(hostAway ? 'orbit.hostAway' : 'orbit.hostOnline')}</span>
          </span>
        )}
      </div>
      <div className="orbit-queue-head__meta">
        <Users size={11} />
        <span className="orbit-queue-head__names">{names.join(', ')}</span>
        {cap > 0 && (
          <span
            className={`orbit-queue-head__pending${pendingCount >= cap ? ' is-full' : ''}`}
            data-tooltip={t('orbit.pendingCounterTooltip')}
          >
            <Inbox size={11} />
            <span>{t('orbit.pendingCounter', { count: pendingCount, max: cap })}</span>
          </span>
        )}
      </div>
    </div>
  );
}
