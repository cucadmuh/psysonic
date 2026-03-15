import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
}

interface AuthState {
  // Multi-server
  servers: ServerProfile[];
  activeServerId: string | null;

  // Last.fm (global)
  lastfmApiKey: string;
  lastfmApiSecret: string;
  lastfmSessionKey: string;
  lastfmUsername: string;

  // Settings (global)
  minimizeToTray: boolean;
  scrobblingEnabled: boolean;
  maxCacheMb: number;
  downloadFolder: string;
  excludeAudiobooks: boolean;
  customGenreBlacklist: string[];

  // Status
  isLoggedIn: boolean;
  isConnecting: boolean;
  connectionError: string | null;

  // Actions
  addServer: (profile: Omit<ServerProfile, 'id'>) => string;
  updateServer: (id: string, data: Partial<Omit<ServerProfile, 'id'>>) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string) => void;
  setLoggedIn: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setConnectionError: (e: string | null) => void;
  setLastfm: (apiKey: string, apiSecret: string, sessionKey: string, username: string) => void;
  setMinimizeToTray: (v: boolean) => void;
  setScrobblingEnabled: (v: boolean) => void;
  setMaxCacheMb: (v: number) => void;
  setDownloadFolder: (v: string) => void;
  setExcludeAudiobooks: (v: boolean) => void;
  setCustomGenreBlacklist: (v: string[]) => void;
  logout: () => void;

  // Derived
  getBaseUrl: () => string;
  getActiveServer: () => ServerProfile | undefined;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,
      lastfmApiKey: '',
      lastfmApiSecret: '',
      lastfmSessionKey: '',
      lastfmUsername: '',
      minimizeToTray: false,
      scrobblingEnabled: true,
      maxCacheMb: 500,
      downloadFolder: '',
      excludeAudiobooks: false,
      customGenreBlacklist: [],
      isLoggedIn: false,
      isConnecting: false,
      connectionError: null,

      addServer: (profile) => {
        const id = generateId();
        set(s => ({ servers: [...s.servers, { ...profile, id }] }));
        return id;
      },

      updateServer: (id, data) => {
        set(s => ({
          servers: s.servers.map(srv => srv.id === id ? { ...srv, ...data } : srv),
        }));
      },

      removeServer: (id) => {
        set(s => {
          const newServers = s.servers.filter(srv => srv.id !== id);
          const switchedAway = s.activeServerId === id;
          return {
            servers: newServers,
            activeServerId: switchedAway ? (newServers[0]?.id ?? null) : s.activeServerId,
            isLoggedIn: switchedAway ? false : s.isLoggedIn,
          };
        });
      },

      setActiveServer: (id) => set({ activeServerId: id }),

      setLoggedIn: (v) => set({ isLoggedIn: v }),
      setConnecting: (v) => set({ isConnecting: v }),
      setConnectionError: (e) => set({ connectionError: e }),

      setLastfm: (apiKey, apiSecret, sessionKey, username) =>
        set({ lastfmApiKey: apiKey, lastfmApiSecret: apiSecret, lastfmSessionKey: sessionKey, lastfmUsername: username }),

      setMinimizeToTray: (v) => set({ minimizeToTray: v }),
      setScrobblingEnabled: (v) => set({ scrobblingEnabled: v }),
      setMaxCacheMb: (v) => set({ maxCacheMb: v }),
      setDownloadFolder: (v) => set({ downloadFolder: v }),
      setExcludeAudiobooks: (v) => set({ excludeAudiobooks: v }),
      setCustomGenreBlacklist: (v) => set({ customGenreBlacklist: v }),

      logout: () => set({ isLoggedIn: false }),

      getBaseUrl: () => {
        const s = get();
        const server = s.servers.find(srv => srv.id === s.activeServerId);
        if (!server?.url) return '';
        return server.url.startsWith('http') ? server.url : `http://${server.url}`;
      },

      getActiveServer: () => {
        const s = get();
        return s.servers.find(srv => srv.id === s.activeServerId);
      },
    }),
    {
      name: 'psysonic-auth',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
