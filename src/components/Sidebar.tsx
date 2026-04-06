import React from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useOfflineStore } from '../store/offlineStore';
import { useAuthStore } from '../store/authStore';
import { useSidebarStore } from '../store/sidebarStore';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Disc3, Users, Music4, Radio, Settings, Heart, BarChart3, Shuffle,
  PanelLeftClose, PanelLeft, HelpCircle, Dices, AudioLines, HardDriveDownload, Tags, ListMusic, Cast
} from 'lucide-react';
import PsysonicLogo from './PsysonicLogo';
import PSmallLogo from './PSmallLogo';

// All configurable nav items — order and visibility controlled by sidebarStore.
// Exported so Settings can render the same item metadata.
export const ALL_NAV_ITEMS: Record<string, { icon: React.ElementType; labelKey: string; to: string; section: 'library' | 'system' }> = {
  mainstage:    { icon: Disc3,      labelKey: 'sidebar.mainstage',    to: '/',              section: 'library' },
  newReleases:  { icon: Radio,      labelKey: 'sidebar.newReleases',  to: '/new-releases',  section: 'library' },
  allAlbums:    { icon: Music4,     labelKey: 'sidebar.allAlbums',    to: '/albums',        section: 'library' },
  randomAlbums: { icon: Dices,      labelKey: 'sidebar.randomAlbums', to: '/random-albums', section: 'library' },
  artists:      { icon: Users,      labelKey: 'sidebar.artists',      to: '/artists',       section: 'library' },
  genres:       { icon: Tags,       labelKey: 'sidebar.genres',       to: '/genres',        section: 'library' },
  randomMix:    { icon: Shuffle,    labelKey: 'sidebar.randomMix',    to: '/random-mix',    section: 'library' },
  favorites:    { icon: Heart,      labelKey: 'sidebar.favorites',    to: '/favorites',     section: 'library' },
  playlists:    { icon: ListMusic,  labelKey: 'sidebar.playlists',    to: '/playlists',     section: 'library' },
  radio:        { icon: Cast,       labelKey: 'sidebar.radio',         to: '/radio',         section: 'library' },
  statistics:   { icon: BarChart3,  labelKey: 'sidebar.statistics',   to: '/statistics',    section: 'system'  },
  help:         { icon: HelpCircle, labelKey: 'sidebar.help',         to: '/help',          section: 'system'  },
};


export default function Sidebar({
  isCollapsed = false,
  toggleCollapse,
}: {
  isCollapsed?: boolean;
  toggleCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const isPlaying   = usePlayerStore(s => s.isPlaying);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const offlineJobs = useOfflineStore(s => s.jobs);
  const activeJobs = offlineJobs.filter(j => j.status === 'queued' || j.status === 'downloading');
  const offlineAlbums = useOfflineStore(s => s.albums);
  const serverId = useAuthStore(s => s.activeServerId ?? '');
  const hasOfflineContent = Object.values(offlineAlbums).some(a => a.serverId === serverId);
  const sidebarItems = useSidebarStore(s => s.items);
  // Resolve ordered, visible items per section from store config
  const visibleLibrary = sidebarItems
    .filter(cfg => cfg.visible && ALL_NAV_ITEMS[cfg.id]?.section === 'library')
    .map(cfg => ALL_NAV_ITEMS[cfg.id]);
  const visibleSystem = sidebarItems
    .filter(cfg => cfg.visible && ALL_NAV_ITEMS[cfg.id]?.section === 'system')
    .map(cfg => ALL_NAV_ITEMS[cfg.id]);


  return (
    <aside className={`sidebar animate-slide-in ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        {isCollapsed
          ? <PSmallLogo style={{ height: '32px', width: 'auto' }} />
          : <PsysonicLogo style={{ height: '28px', width: 'auto' }} />
        }
      </div>

      <button
        className="collapse-btn"
        onClick={toggleCollapse}
        data-tooltip={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        data-tooltip-pos="right"
      >
        {isCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
      </button>

      <nav className="sidebar-nav" aria-label="Hauptnavigation">
        {!isCollapsed && <span className="nav-section-label">{t('sidebar.library')}</span>}
        {visibleLibrary.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            data-tooltip={isCollapsed ? t(item.labelKey) : undefined}
            data-tooltip-pos="bottom"
          >
            <item.icon size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t(item.labelKey)}</span>}
          </NavLink>
        ))}

        {/* Now Playing — fixed, always visible */}
        <NavLink
          to="/now-playing"
          className={({ isActive }) => `nav-link nav-link-nowplaying ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.nowPlaying') : undefined}
          data-tooltip-pos="bottom"
          style={{ marginTop: 'auto' }}
        >
          <span className="nav-np-icon-wrap">
            <AudioLines size={isCollapsed ? 22 : 18} />
            {isPlaying && currentTrack && <span className="nav-np-dot" />}
          </span>
          {!isCollapsed && <span>{t('sidebar.nowPlaying')}</span>}
        </NavLink>

        {hasOfflineContent && (
          <NavLink
            to="/offline"
            className={({ isActive }) => `nav-link nav-link-offline ${isActive ? 'active' : ''}`}
            data-tooltip={isCollapsed ? t('sidebar.offlineLibrary') : undefined}
            data-tooltip-pos="bottom"
          >
            <HardDriveDownload size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t('sidebar.offlineLibrary')}</span>}
          </NavLink>
        )}

        {visibleSystem.length > 0 && !isCollapsed && <span className="nav-section-label">{t('sidebar.system')}</span>}
{visibleSystem.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            data-tooltip={isCollapsed ? t(item.labelKey) : undefined}
            data-tooltip-pos="bottom"
          >
            <item.icon size={isCollapsed ? 22 : 18} />
            {!isCollapsed && <span>{t(item.labelKey)}</span>}
          </NavLink>
        ))}
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          data-tooltip={isCollapsed ? t('sidebar.settings') : undefined}
          data-tooltip-pos="bottom"
        >
          <Settings size={isCollapsed ? 22 : 18} />
          {!isCollapsed && <span>{t('sidebar.settings')}</span>}
        </NavLink>

        {activeJobs.length > 0 && (
          <div
            className={`sidebar-offline-queue ${isCollapsed ? 'sidebar-offline-queue--collapsed' : ''}`}
            data-tooltip={isCollapsed ? t('sidebar.downloadingTracks', { n: activeJobs.length }) : undefined}
            data-tooltip-pos="right"
          >
            <HardDriveDownload size={isCollapsed ? 18 : 14} className="spin-slow" />
            {!isCollapsed && (
              <span>{t('sidebar.downloadingTracks', { n: activeJobs.length })}</span>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}
