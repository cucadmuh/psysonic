import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Music, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubsonicSong } from '../../api/subsonicTypes';
import type { ServerProfile } from '../../store/authStoreTypes';
import { formatTrackTime } from '../../utils/format/formatDuration';
import type { ShareQueuePreviewState } from '../../hooks/useShareQueuePreview';
import { sharePayloadTotal, type QueueableShareSearchPayload } from '../../utils/share/shareSearch';
import CachedImage from '../CachedImage';
import {
  buildCoverArtUrl,
  buildCoverArtUrlForServer,
  coverArtCacheKey,
  coverArtCacheKeyForServer,
} from '../../api/subsonicStreamUrl';

type ShareQueuePreviewModalProps = {
  open: boolean;
  onClose: () => void;
  payload: Extract<QueueableShareSearchPayload, { k: 'queue' }>;
  preview: ShareQueuePreviewState;
  shareServerLabel?: string | null;
  coverServer?: ServerProfile | null;
  onEnqueue: () => void;
  enqueueBusy: boolean;
};

function QueuePreviewTrackRow({
  song,
  coverServer,
}: {
  song: SubsonicSong;
  coverServer?: ServerProfile | null;
}) {
  const coverId = song.coverArt ?? '';
  const src = coverServer
    ? buildCoverArtUrlForServer(coverServer.url, coverServer.username, coverServer.password, coverId || song.id, 48)
    : buildCoverArtUrl(coverId || song.id, 48);
  const cacheKey = coverServer
    ? coverArtCacheKeyForServer(coverServer.id, coverId || song.id, 48)
    : coverArtCacheKey(coverId || song.id, 48);

  return (
    <li className="share-queue-preview-track">
      {coverId ? (
        <CachedImage className="share-queue-preview-track__thumb" src={src} cacheKey={cacheKey} alt="" />
      ) : (
        <div className="share-queue-preview-track__icon">
          <Music size={16} />
        </div>
      )}
      <div className="share-queue-preview-track__meta">
        <div className="share-queue-preview-track__title">{song.title}</div>
        <div className="share-queue-preview-track__sub">
          {song.artist}{song.album ? ` · ${song.album}` : ''}
        </div>
      </div>
      <span className="share-queue-preview-track__dur">{formatTrackTime(song.duration)}</span>
    </li>
  );
}

function PreviewBody({
  preview,
  coverServer,
}: {
  preview: ShareQueuePreviewState;
  coverServer?: ServerProfile | null;
}) {
  const { t } = useTranslation();

  if (preview.status === 'loading' || preview.status === 'idle') {
    return <div className="share-queue-preview-modal__status">{t('search.shareQueuePreviewLoading')}</div>;
  }

  if (preview.status === 'error') {
    const msg =
      preview.result.type === 'not-logged-in'
        ? t('sharePaste.notLoggedIn')
        : preview.result.type === 'no-matching-server'
          ? t('sharePaste.noMatchingServer', { url: preview.result.url })
          : preview.result.type === 'all-unavailable'
            ? t('search.shareQueuePreviewEmpty')
            : t('sharePaste.genericError');
    return <div className="share-queue-preview-modal__status share-queue-preview-modal__status--error">{msg}</div>;
  }

  return (
    <>
      {preview.skipped > 0 && (
        <p className="share-queue-preview-modal__skipped">
          {t('search.shareQueuePreviewSkipped', { skipped: preview.skipped, total: preview.total })}
        </p>
      )}
      <ul className="share-queue-preview-modal__list">
        {preview.songs.map(song => (
          <QueuePreviewTrackRow key={song.id} song={song} coverServer={coverServer} />
        ))}
      </ul>
    </>
  );
}

export default function ShareQueuePreviewModal({
  open,
  onClose,
  payload,
  preview,
  shareServerLabel,
  coverServer,
  onEnqueue,
  enqueueBusy,
}: ShareQueuePreviewModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const count = sharePayloadTotal(payload);
  const canEnqueue = preview.status === 'ok' && preview.songs.length > 0;

  return createPortal(
    <div
      className="modal-overlay share-queue-preview-modal-overlay"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content share-queue-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-queue-preview-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} />
        </button>

        <header className="share-queue-preview-modal__header">
          <h2 id="share-queue-preview-title" className="share-queue-preview-modal__title">
            {t('search.shareQueueTitle', { count })}
          </h2>
          {shareServerLabel && (
            <p className="share-queue-preview-modal__server">
              {t('search.shareFromServer', { server: shareServerLabel })}
            </p>
          )}
        </header>

        <div className="share-queue-preview-modal__body">
          <PreviewBody preview={preview} coverServer={coverServer} />
        </div>

        <footer className="share-queue-preview-modal__footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEnqueue || enqueueBusy}
            onClick={() => void onEnqueue()}
          >
            {enqueueBusy ? t('search.shareQueueing') : t('search.shareQueueAction')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
