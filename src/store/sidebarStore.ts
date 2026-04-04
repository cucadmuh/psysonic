import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SidebarItemConfig {
  id: string;
  visible: boolean;
}

// All configurable nav items in their default order.
// Fixed items (nowPlaying, settings, offline) are not listed here.
export const DEFAULT_SIDEBAR_ITEMS: SidebarItemConfig[] = [
  { id: 'mainstage',     visible: true },
  { id: 'newReleases',   visible: true },
  { id: 'allAlbums',     visible: true },
  { id: 'randomAlbums',  visible: true },
  { id: 'artists',       visible: true },
  { id: 'genres',        visible: true },
  { id: 'randomMix',     visible: true },
  { id: 'favorites',     visible: true },
  { id: 'playlists',     visible: true },
  { id: 'radio',         visible: true },
  { id: 'statistics',    visible: true },
  { id: 'help',          visible: true },
];

interface SidebarStore {
  items: SidebarItemConfig[];
  setItems: (items: SidebarItemConfig[]) => void;
  toggleItem: (id: string) => void;
  reset: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      items: DEFAULT_SIDEBAR_ITEMS,

      setItems: (items) => set({ items }),

      toggleItem: (id) => set((s) => ({
        items: s.items.map(item => item.id === id ? { ...item, visible: !item.visible } : item),
      })),

      reset: () => set({ items: DEFAULT_SIDEBAR_ITEMS }),
    }),
    {
      name: 'psysonic_sidebar',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const known = new Set(state.items.map(i => i.id));
        const missing = DEFAULT_SIDEBAR_ITEMS.filter(i => !known.has(i.id));
        if (missing.length > 0) {
          state.items = [...state.items, ...missing];
        }
      },
    }
  )
);
