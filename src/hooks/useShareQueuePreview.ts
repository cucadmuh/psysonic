import { useEffect, useState } from 'react';
import type { SubsonicSong } from '../api/subsonicTypes';
import {
  resolveShareSearchPayload,
  type ShareSearchResolveResult,
} from '../utils/share/enqueueShareSearchPayload';
import type { QueueableShareSearchPayload } from '../utils/share/shareSearch';

export type ShareQueuePreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; songs: SubsonicSong[]; total: number; skipped: number }
  | { status: 'error'; result: Exclude<ShareSearchResolveResult, { type: 'ok' }> };

const IDLE: ShareQueuePreviewState = { status: 'idle' };

export function useShareQueuePreview(
  payload: Extract<QueueableShareSearchPayload, { k: 'queue' }> | null,
  open: boolean,
): ShareQueuePreviewState {
  const [state, setState] = useState<ShareQueuePreviewState>(IDLE);

  useEffect(() => {
    if (!open || !payload) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    void resolveShareSearchPayload(payload)
      .then(result => {
        if (cancelled) return;
        if (result.type === 'ok') {
          setState({
            status: 'ok',
            songs: result.songs,
            total: result.total,
            skipped: result.skipped,
          });
          return;
        }
        setState({ status: 'error', result });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', result: { type: 'error' } });
      });

    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  return state;
}
