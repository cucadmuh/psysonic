import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { check, Update, DownloadEvent } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { RefreshCw, Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { version as currentVersion } from '../../package.json';

// Semver comparison: returns true if `a` is newer than `b`
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^[^0-9]*/, '').split('.').map(Number);
  const pb = b.replace(/^[^0-9]*/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

type State =
  | { phase: 'idle' }
  | { phase: 'available'; version: string; update: Update | null }
  | { phase: 'downloading'; pct: number }
  | { phase: 'installing' }
  | { phase: 'done' };

export default function AppUpdater() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        // Try Tauri native updater first (macOS + Windows)
        const update = await check();
        if (cancelled) return;
        if (update) {
          setState({ phase: 'available', version: update.version, update });
          return;
        }
      } catch {
        // Tauri updater unavailable or network error — fall through to GitHub check
      }
      // Fallback: GitHub API check (Linux / offline Tauri updater)
      try {
        const res = await fetch('https://api.github.com/repos/Psychotoxical/psysonic/releases/latest');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? '';
        if (!cancelled && tag && isNewer(tag, currentVersion)) {
          setState({ phase: 'available', version: tag.replace(/^[^0-9]*/, ''), update: null });
        }
      } catch {
        // No update check possible — stay idle
      }
    }, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (dismissed || state.phase === 'idle' || state.phase === 'done') return null;

  const handleInstall = async () => {
    if (state.phase !== 'available' || !state.update) return;
    const update = state.update;
    const savedVersion = state.version;
    let total = 0;
    let downloaded = 0;
    setState({ phase: 'downloading', pct: 0 });
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setState({ phase: 'downloading', pct: total ? Math.round((downloaded / total) * 100) : 0 });
        } else if (event.event === 'Finished') {
          setState({ phase: 'installing' });
        }
      });
      await invoke('relaunch_after_update');
    } catch (e) {
      console.error('Update failed', e);
      setState({ phase: 'available', version: savedVersion, update });
    }
  };

  const handleDownload = () => {
    open('https://github.com/Psychotoxical/psysonic/releases/latest');
  };

  const version = state.phase === 'available' ? state.version : '';
  const canInstall = state.phase === 'available' && state.update !== null;
  const isLinuxFallback = state.phase === 'available' && state.update === null;

  return createPortal(
    <div className="app-updater-toast">
      <div className="app-updater-header">
        <RefreshCw size={13} />
        <span className="app-updater-label">{t('common.updaterAvailable')}</span>
        <button className="app-updater-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>
      <div className="app-updater-version">{t('common.updaterVersion', { version })}</div>

      {state.phase === 'downloading' && (
        <div className="app-updater-progress-wrap">
          <div className="app-updater-progress-bar">
            <div className="app-updater-progress-fill" style={{ width: `${state.pct}%` }} />
          </div>
          <span className="app-updater-pct">{state.pct}%</span>
        </div>
      )}

      {state.phase === 'installing' && (
        <div className="app-updater-status">{t('common.updaterInstalling')}</div>
      )}

      {state.phase === 'available' && (
        <div className="app-updater-actions">
          {canInstall && (
            <button className="app-updater-btn-primary" onClick={handleInstall}>
              <Download size={12} /> {t('common.updaterInstall')}
            </button>
          )}
          {isLinuxFallback && (
            <button className="app-updater-btn-primary" onClick={handleDownload}>
              <Download size={12} /> {t('common.updaterDownload')}
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
