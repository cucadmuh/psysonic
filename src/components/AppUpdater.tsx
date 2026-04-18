import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-shell';
import { listen } from '@tauri-apps/api/event';
import { dirname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { ArrowUpCircle, ChevronDown, Download, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { version as currentVersion } from '../../package.json';
import { IS_LINUX, IS_MACOS, IS_WINDOWS } from '../utils/platform';

const SKIP_KEY = 'psysonic_skipped_update_version';

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

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Minimal inline-markdown renderer (bold, italic, code)
// IMPORTANT: regex must have NO nested capture groups — split() includes captured
// groups in the result, and nested groups produce undefined entries that crash on .startsWith()
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="changelog-code">{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderChangelog(body: string) {
  return body.split('\n').map((line, i) => {
    if (line.startsWith('### '))
      return <div key={i} className="changelog-h3">{renderInline(line.slice(4))}</div>;
    if (line.startsWith('#### '))
      return <div key={i} className="changelog-h4">{renderInline(line.slice(5))}</div>;
    if (line.startsWith('## '))
      return null; // skip nested release headers in body
    if (line.startsWith('- '))
      return <div key={i} className="changelog-item">{renderInline(line.slice(2))}</div>;
    if (line.trim() === '') return null;
    return <div key={i} className="changelog-text">{renderInline(line)}</div>;
  });
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleaseData {
  version: string;
  tag: string;
  body: string;
  assets: GithubAsset[];
}

function pickAsset(assets: GithubAsset[]): GithubAsset | undefined {
  if (IS_WINDOWS) {
    return assets.find(a => a.name.endsWith('-setup.exe'))
      ?? assets.find(a => a.name.endsWith('.exe'));
  }
  if (IS_MACOS) {
    // Prefer Apple Silicon, fall back to Intel
    return assets.find(a => a.name.endsWith('.dmg') && a.name.includes('aarch64'))
      ?? assets.find(a => a.name.endsWith('.dmg'));
  }
  if (IS_LINUX) {
    // AppImage > deb > rpm
    return assets.find(a => a.name.endsWith('.AppImage'))
      ?? assets.find(a => a.name.endsWith('.deb'))
      ?? assets.find(a => a.name.endsWith('.rpm'));
  }
  return undefined;
}

type DlState = 'idle' | 'downloading' | 'done' | 'error';

export default function AppUpdater() {
  const { t } = useTranslation();
  const [release, setRelease] = useState<ReleaseData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [isArch, setIsArch] = useState(false);
  const [dlState, setDlState] = useState<DlState>('idle');
  const [dlProgress, setDlProgress] = useState({ bytes: 0, total: 0 });
  const [dlPath, setDlPath] = useState('');
  const [dlError, setDlError] = useState('');
  const unlistenRef = useRef<(() => void) | null>(null);

  const fetchRelease = async (preview = false) => {
    try {
      const res = await fetch('https://api.github.com/repos/Psychotoxical/psysonic/releases/latest');
      if (!res.ok) return;
      const data = await res.json();
      const tag: string = data.tag_name ?? '';
      const version = tag.replace(/^[^0-9]*/, '');
      if (!version) return;
      if (!preview) {
        if (!isNewer(version, currentVersion)) return;
        const skipped = localStorage.getItem(SKIP_KEY);
        if (skipped === version) return;
      }
      setDismissed(false);
      setDlState('idle');
      setRelease({
        version,
        tag,
        body: (data.body ?? '').trim(),
        assets: data.assets ?? [],
      });
      if (IS_LINUX) {
        const arch = await invoke<boolean>('check_arch_linux');
        setIsArch(arch);
      }
    } catch {
      // No network or rate-limited — stay idle
    }
  };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) fetchRelease(); }, 4000);

    const handler = () => fetchRelease(true);
    window.addEventListener('psysonic:preview-update', handler);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('psysonic:preview-update', handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up download listener when component unmounts
  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  if (!release || dismissed) return null;

  const asset = pickAsset(release.assets);
  const showAurHint = IS_LINUX && isArch;

  const handleSkip = () => {
    localStorage.setItem(SKIP_KEY, release.version);
    setDismissed(true);
  };

  const handleDownload = async () => {
    // On macOS: use the Tauri Updater plugin — downloads .app.tar.gz, verifies
    // the minisign signature against the bundled pubkey, replaces the .app, and
    // relaunches. No manual "open the DMG" step needed.
    if (IS_MACOS) {
      setDlState('downloading');
      setDlProgress({ bytes: 0, total: 0 });
      setDlError('');
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update) {
          setDlError(t('common.updaterErrorMsg'));
          setDlState('error');
          return;
        }
        let downloaded = 0;
        let total = 0;
        await update.downloadAndInstall(event => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? 0;
            setDlProgress({ bytes: 0, total });
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            setDlProgress({ bytes: downloaded, total });
          } else if (event.event === 'Finished') {
            setDlState('done');
          }
        });
        // downloadAndInstall replaces the .app and relaunches automatically on macOS.
      } catch (e) {
        setDlError(String(e));
        setDlState('error');
      }
      return;
    }

    if (!asset) return;
    setDlState('downloading');
    setDlProgress({ bytes: 0, total: asset.size });
    setDlError('');

    const unlisten = await listen<{ bytes: number; total: number | null }>(
      'update:download:progress',
      e => {
        setDlProgress({
          bytes: e.payload.bytes,
          total: e.payload.total ?? asset.size,
        });
      }
    );
    unlistenRef.current = unlisten;

    try {
      const finalPath = await invoke<string>('download_update', {
        url: asset.browser_download_url,
        filename: asset.name,
      });
      unlisten();
      unlistenRef.current = null;
      setDlPath(finalPath);
      setDlState('done');
    } catch (e) {
      unlisten();
      unlistenRef.current = null;
      setDlError(String(e));
      setDlState('error');
    }
  };

  const handleShowFolder = async () => {
    // tauri-plugin-shell's open() only allows https:// per capability scope —
    // local paths are blocked and fail silently. Delegate to Rust instead.
    const dir = await dirname(dlPath);
    await invoke('open_folder', { path: dir });
  };

  const pct = dlProgress.total > 0
    ? Math.min(100, Math.round((dlProgress.bytes / dlProgress.total) * 100))
    : 0;

  return createPortal(
    <>
      <div className="eq-popup-backdrop" onClick={() => setDismissed(true)} style={{ zIndex: 3000 }} />
      <div
        className="eq-popup update-modal"
        style={{ zIndex: 3001 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="eq-popup-header update-modal-header">
          <ArrowUpCircle size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="eq-popup-title">{t('common.updaterModalTitle')}</span>
            <span className="update-modal-versions">
              v{currentVersion} → <strong>v{release.version}</strong>
            </span>
          </div>
          <button
            className="app-updater-dismiss"
            onClick={() => setDismissed(true)}
            data-tooltip={t('common.updaterRemindBtn')}
            data-tooltip-pos="bottom"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body: changelog + download area — single overflow container */}
        <div className="update-modal-body">
          {/* Collapsible Changelog */}
          {release.body && (
            <div className="update-modal-changelog">
              <button
                type="button"
                className="update-modal-changelog-toggle"
                onClick={() => setChangelogOpen(v => !v)}
              >
                <ChevronDown
                  size={13}
                  style={{
                    transform: changelogOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                    flexShrink: 0,
                  }}
                />
                {t('common.updaterChangelog')}
              </button>
              {changelogOpen && (
                <div className="update-modal-changelog-body">
                  {renderChangelog(release.body)}
                </div>
              )}
            </div>
          )}

        {/* Download / AUR area */}
        <div className="update-modal-download-area">
          {showAurHint ? (
            <div className="update-modal-aur">
              <div className="update-modal-aur-title">{t('common.updaterAurHint')}</div>
              <code className="update-modal-aur-cmd">yay -S psysonic-bin</code>
              <code className="update-modal-aur-cmd update-modal-aur-alt">sudo pacman -Syu psysonic-bin</code>
            </div>
          ) : asset ? (
            <>
              {dlState === 'idle' && (
                <div className="update-modal-asset">
                  <span className="update-modal-asset-name">{asset.name}</span>
                  <span className="update-modal-asset-size">{fmtBytes(asset.size)}</span>
                </div>
              )}
              {dlState === 'downloading' && (
                <div className="update-modal-progress">
                  <div className="app-updater-progress-bar">
                    <div className="app-updater-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="app-updater-pct">{pct}%</span>
                  <span className="update-modal-dl-bytes">
                    {fmtBytes(dlProgress.bytes)}
                    {dlProgress.total > 0 && ` / ${fmtBytes(dlProgress.total)}`}
                  </span>
                </div>
              )}
              {dlState === 'done' && (
                <div className="update-modal-done">
                  <div className="update-modal-done-title">{t('common.updaterDone')}</div>
                  <div className="update-modal-done-hint">{t('common.updaterInstallHint')}</div>
                  <button className="btn btn-surface update-modal-folder-btn" onClick={handleShowFolder}>
                    <FolderOpen size={14} />
                    {t('common.updaterShowFolder')}
                  </button>
                </div>
              )}
              {dlState === 'error' && (
                <div className="app-updater-error">{dlError || t('common.updaterErrorMsg')}</div>
              )}
            </>
          ) : (
            <div className="update-modal-asset-none">
              <button
                className="app-updater-btn-primary"
                onClick={() => open(`https://github.com/Psychotoxical/psysonic/releases/tag/${release.tag}`)}
              >
                {t('common.updaterOpenGitHub')}
              </button>
            </div>
          )}
        </div>
        </div>{/* end update-modal-body */}

        {/* Footer buttons */}
        <div className="update-modal-footer">
          <button className="btn btn-ghost update-modal-skip" onClick={handleSkip}>
            {t('common.updaterSkipBtn')}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-surface" onClick={() => setDismissed(true)}>
            {t('common.updaterRemindBtn')}
          </button>
          {!showAurHint && asset && dlState === 'idle' && (
            <button className="btn btn-primary" onClick={handleDownload}>
              <Download size={14} />
              {t('common.updaterDownloadBtn')}
            </button>
          )}
          {dlState === 'error' && (
            <button className="btn btn-primary" onClick={handleDownload}>
              {t('common.updaterRetryBtn')}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
