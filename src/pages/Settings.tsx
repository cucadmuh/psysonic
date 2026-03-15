import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wifi, WifiOff, Globe, Music2, Sliders, LogOut, CheckCircle2, FolderOpen, Palette, Server, Plus, Trash2, Eye, EyeOff, Info, ExternalLink, Shuffle
} from 'lucide-react';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { useAuthStore, ServerProfile } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { pingWithCredentials } from '../api/subsonic';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';

const AUDIOBOOK_GENRES_DISPLAY = ['Hörbuch', 'Hoerbuch', 'Hörspiel', 'Hoerspiel', 'Audiobook', 'Audio Book', 'Spoken Word', 'Spokenword', 'Podcast', 'Kapitel', 'Thriller', 'Krimi', 'Speech', 'Fantasy', 'Comedy', 'Literature'];

function AddServerForm({ onSave, onCancel }: { onSave: (data: Omit<ServerProfile, 'id'>) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '' });
  const [showPass, setShowPass] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="settings-card" style={{ marginTop: '1rem' }}>
      <h3 style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '14px' }}>{t('settings.addServerTitle')}</h3>
      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontSize: 13 }}>{t('settings.serverName')}</label>
        <input className="input" type="text" value={form.name} onChange={update('name')} placeholder="My Navidrome" autoComplete="off" />
      </div>
      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontSize: 13 }}>{t('settings.serverUrl')}</label>
        <input className="input" type="text" value={form.url} onChange={update('url')} placeholder="192.168.1.100:4533" autoComplete="off" />
      </div>
      <div className="form-row" style={{ marginBottom: '0.75rem' }}>
        <div className="form-group">
          <label style={{ fontSize: 13 }}>{t('settings.serverUsername')}</label>
          <input className="input" type="text" value={form.username} onChange={update('username')} placeholder="admin" autoComplete="off" />
        </div>
        <div className="form-group">
          <label style={{ fontSize: 13 }}>{t('settings.serverPassword')}</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPass ? 'text' : 'password'}
              value={form.password}
              onChange={update('password')}
              placeholder="••••••••"
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              onClick={() => setShowPass(v => !v)}
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="btn btn-primary"
          onClick={() => form.url.trim() && onSave({ name: form.name.trim() || form.url.trim(), url: form.url.trim(), username: form.username.trim(), password: form.password })}
        >
          {t('common.add')}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const auth = useAuthStore();
  const theme = useThemeStore();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [connStatus, setConnStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newGenre, setNewGenre] = useState('');

  const testConnection = async (server: ServerProfile) => {
    setConnStatus(s => ({ ...s, [server.id]: 'testing' }));
    try {
      const ok = await pingWithCredentials(server.url, server.username, server.password);
      setConnStatus(s => ({ ...s, [server.id]: ok ? 'ok' : 'error' }));
    } catch {
      setConnStatus(s => ({ ...s, [server.id]: 'error' }));
    }
  };

  const switchToServer = async (server: ServerProfile) => {
    setConnStatus(s => ({ ...s, [server.id]: 'testing' }));
    try {
      const ok = await pingWithCredentials(server.url, server.username, server.password);
      if (ok) {
        auth.setActiveServer(server.id);
        auth.setLoggedIn(true);
        navigate('/');
      } else {
        setConnStatus(s => ({ ...s, [server.id]: 'error' }));
      }
    } catch {
      setConnStatus(s => ({ ...s, [server.id]: 'error' }));
    }
  };

  const deleteServer = (server: ServerProfile) => {
    if (confirm(t('settings.confirmDeleteServer', { name: server.name || server.url }))) {
      auth.removeServer(server.id);
    }
  };

  const handleAddServer = async (data: Omit<ServerProfile, 'id'>) => {
    setShowAddForm(false);
    const tempId = '_new';
    setConnStatus(s => ({ ...s, [tempId]: 'testing' }));
    try {
      const ok = await pingWithCredentials(data.url, data.username, data.password);
      if (ok) {
        const id = auth.addServer(data);
        auth.setActiveServer(id);
        auth.setLoggedIn(true);
        setConnStatus(s => ({ ...s, [id]: 'ok' }));
      } else {
        setConnStatus(s => ({ ...s, [tempId]: 'error' }));
      }
    } catch {
      setConnStatus(s => ({ ...s, [tempId]: 'error' }));
    }
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  const pickDownloadFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: t('settings.pickFolderTitle') });
    if (selected && typeof selected === 'string') {
      auth.setDownloadFolder(selected);
    }
  };

  return (
    <div className="content-body animate-fade-in">
      <h1 className="page-title" style={{ marginBottom: '2rem' }}>{t('settings.title')}</h1>

      {/* Language */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Globe size={18} />
          <h2>{t('settings.language')}</h2>
        </div>
        <div className="settings-card">
          <div className="form-group" style={{ maxWidth: '300px' }}>
            <select
              className="input"
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label={t('settings.language')}
            >
              <option value="en">{t('settings.languageEn')}</option>
              <option value="de">{t('settings.languageDe')}</option>
            </select>
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Palette size={18} />
          <h2>{t('settings.theme')}</h2>
        </div>
        <div className="settings-card">
          <div className="form-group" style={{ maxWidth: '300px' }}>
            <select
              className="input"
              value={theme.theme}
              onChange={(e) => theme.setTheme(e.target.value as any)}
              aria-label={t('settings.theme')}
            >
              <option value="mocha">Catppuccin Mocha</option>
              <option value="macchiato">Catppuccin Macchiato</option>
              <option value="frappe">Catppuccin Frappé</option>
              <option value="latte">Catppuccin Latte</option>
              <option value="nord">Nord · Polar Night</option>
              <option value="nord-snowstorm">Nord · Snowstorm</option>
              <option value="nord-frost">Nord · Frost</option>
              <option value="nord-aurora">Nord · Aurora</option>
            </select>
          </div>
        </div>
      </section>

      {/* Servers */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Server size={18} />
          <h2>{t('settings.servers')}</h2>
        </div>

        {auth.servers.length === 0 && !showAddForm ? (
          <div className="settings-card" style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {t('settings.noServers')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {auth.servers.map(srv => {
              const isActive = srv.id === auth.activeServerId;
              const status = connStatus[srv.id];
              return (
                <div key={srv.id} className="settings-card" style={{ border: isActive ? '1px solid var(--accent)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2px' }}>
                        <span style={{ fontWeight: 600 }}>{srv.name || srv.url}</span>
                        {isActive && (
                          <span style={{ fontSize: 11, background: 'var(--accent)', color: 'var(--ctp-crust)', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
                            {t('settings.serverActive')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{srv.username}@{srv.url}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                      {status === 'ok' && <CheckCircle2 size={16} style={{ color: 'var(--positive)' }} />}
                      {status === 'error' && <WifiOff size={16} style={{ color: 'var(--danger)' }} />}
                      {status === 'testing' && <div className="spinner" style={{ width: 16, height: 16 }} />}
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => testConnection(srv)}
                        disabled={status === 'testing'}
                      >
                        <Wifi size={13} />
                        {t('settings.testBtn')}
                      </button>
                      {!isActive && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          onClick={() => switchToServer(srv)}
                          disabled={status === 'testing'}
                          id={`settings-use-server-${srv.id}`}
                        >
                          {t('settings.useServer')}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--danger)', padding: '4px 8px' }}
                        onClick={() => deleteServer(srv)}
                        data-tooltip={t('settings.deleteServer')}
                        id={`settings-delete-server-${srv.id}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showAddForm ? (
          <AddServerForm onSave={handleAddServer} onCancel={() => setShowAddForm(false)} />
        ) : (
          <button className="btn btn-ghost" style={{ marginTop: '0.75rem' }} onClick={() => setShowAddForm(true)} id="settings-add-server-btn">
            <Plus size={16} /> {t('settings.addServer')}
          </button>
        )}
      </section>

      {/* Last.fm */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Music2 size={18} />
          <h2>{t('settings.lfmTitle')}</h2>
        </div>
        <div className="settings-card">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
            <p style={{ marginBottom: '0.5rem' }}>
              {t('settings.lfmDesc1')}{' '}
              <strong>{t('settings.lfmDesc1NavidromeWebplayer')}</strong>
              {' '}{t('settings.lfmDesc1b')}
            </p>
            <p>{t('settings.lfmDesc2')}</p>
          </div>

          <div className="settings-toggle-row" style={{ marginTop: '1rem' }}>
            <div>
              <div style={{ fontWeight: 500 }}>{t('settings.scrobbleEnabled')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.scrobbleDesc')}</div>
            </div>
            <label className="toggle-switch" aria-label={t('settings.scrobbleEnabled')}>
              <input type="checkbox" checked={auth.scrobblingEnabled} onChange={e => auth.setScrobblingEnabled(e.target.checked)} id="scrobbling-toggle" />
              <span className="toggle-track" />
            </label>
          </div>
        </div>
      </section>

      {/* App Behavior */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Sliders size={18} />
          <h2>{t('settings.behavior')}</h2>
        </div>
        <div className="settings-card">
          <div className="settings-toggle-row">
            <div>
              <div style={{ fontWeight: 500 }}>{t('settings.trayTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.trayDesc')}</div>
            </div>
            <label className="toggle-switch" aria-label={t('settings.trayTitle')}>
              <input type="checkbox" checked={auth.minimizeToTray} onChange={e => auth.setMinimizeToTray(e.target.checked)} id="tray-toggle" />
              <span className="toggle-track" />
            </label>
          </div>

          <div className="divider" />

          <div className="settings-toggle-row">
            <div>
              <div style={{ fontWeight: 500 }}>{t('settings.cacheTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.cacheDesc')} ({auth.maxCacheMb} MB)</div>
            </div>
            <input
              type="range"
              min={100}
              max={2000}
              step={100}
              value={auth.maxCacheMb}
              onChange={e => auth.setMaxCacheMb(Number(e.target.value))}
              style={{ width: 120 }}
              id="cache-size-slider"
            />
          </div>
          <div className="divider" />

          <div className="settings-toggle-row">
            <div>
              <div style={{ fontWeight: 500 }}>{t('settings.downloadsTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
                {auth.downloadFolder || t('settings.downloadsDefault')}
              </div>
            </div>
            <button className="btn btn-ghost" onClick={pickDownloadFolder} id="settings-download-folder-btn" style={{ flexShrink: 0 }}>
              <FolderOpen size={16} /> {t('settings.pickFolder')}
            </button>
          </div>
        </div>
      </section>

      {/* Random Mix */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Shuffle size={18} />
          <h2>{t('settings.randomMixTitle')}</h2>
        </div>
        <div className="settings-card">
          {/* Description */}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
            {t('settings.randomMixBlacklistDesc')}
          </p>

          {/* Custom blacklist chips */}
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: '0.5rem' }}>{t('settings.randomMixBlacklistTitle')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.75rem', minHeight: 32 }}>
            {auth.customGenreBlacklist.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{t('settings.randomMixBlacklistEmpty')}</span>
            ) : (
              auth.customGenreBlacklist.map(genre => (
                <span key={genre} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                  color: 'var(--accent)', borderRadius: 'var(--radius-sm)',
                  padding: '2px 8px', fontSize: 12, fontWeight: 500,
                }}>
                  {genre}
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: 14 }}
                    onClick={() => auth.setCustomGenreBlacklist(auth.customGenreBlacklist.filter(g => g !== genre))}
                    aria-label={`Remove ${genre}`}
                  >×</button>
                </span>
              ))
            )}
          </div>

          {/* Add input */}
          <div style={{ display: 'flex', gap: '0.5rem', maxWidth: 400 }}>
            <input
              className="input"
              type="text"
              value={newGenre}
              onChange={e => setNewGenre(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newGenre.trim()) {
                  const trimmed = newGenre.trim();
                  if (!auth.customGenreBlacklist.includes(trimmed)) {
                    auth.setCustomGenreBlacklist([...auth.customGenreBlacklist, trimmed]);
                  }
                  setNewGenre('');
                }
              }}
              placeholder={t('settings.randomMixBlacklistPlaceholder')}
              style={{ fontSize: 13 }}
            />
            <button
              className="btn btn-ghost"
              onClick={() => {
                const trimmed = newGenre.trim();
                if (trimmed && !auth.customGenreBlacklist.includes(trimmed)) {
                  auth.setCustomGenreBlacklist([...auth.customGenreBlacklist, trimmed]);
                }
                setNewGenre('');
              }}
              disabled={!newGenre.trim()}
            >
              {t('settings.randomMixBlacklistAdd')}
            </button>
          </div>

          <div className="divider" style={{ margin: '1rem 0' }} />

          {/* Hardcoded list */}
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>{t('settings.randomMixHardcodedTitle')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {AUDIOBOOK_GENRES_DISPLAY.map(genre => (
              <span key={genre} style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'var(--bg-hover)', color: 'var(--text-muted)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 12,
              }}>
                {genre}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Logout */}
      <section className="settings-section">
        <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={handleLogout} id="settings-logout-btn">
          <LogOut size={16} /> {t('settings.logout')}
        </button>
      </section>

      {/* About */}
      <section className="settings-section">
        <div className="settings-section-header">
          <Info size={18} />
          <h2>{t('settings.aboutTitle')}</h2>
        </div>
        <div className="settings-card settings-about">
          <div className="settings-about-header">
            <img src="/logo.png" width={52} height={52} alt="Psysonic" style={{ borderRadius: 14 }} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Psysonic
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {t('settings.aboutVersion')} 1.0.12
              </div>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '1rem 0 0.5rem' }}>
            {t('settings.aboutDesc')}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0.5rem 0' }}>
            {t('settings.aboutFeatures')}
          </p>

          <div className="divider" style={{ margin: '1rem 0' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>{t('settings.aboutLicense')}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{t('settings.aboutLicenseText')}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>Stack</span>
              <span style={{ color: 'var(--text-secondary)' }}>{t('settings.aboutBuiltWith')}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>AI</span>
              <span style={{ color: 'var(--text-secondary)' }}>{t('settings.aboutAiCredit')}</span>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            style={{ marginTop: '1.25rem', alignSelf: 'flex-start' }}
            onClick={() => openUrl('https://github.com/Psychotoxical/psysonic')}
          >
            <ExternalLink size={14} />
            {t('settings.aboutRepo')}
          </button>
        </div>
      </section>
    </div>
  );
}
