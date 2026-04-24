import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../store/authStore';
import { ndLogin } from './navidromeAdmin';

export type SmartRuleOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'lt'
  | 'inTheRange';

export interface SmartRuleCondition {
  field: string;
  operator: SmartRuleOperator;
  value: string | number | boolean | [number, number];
}

export interface NdSmartPlaylist {
  id: string;
  name: string;
  songCount: number;
  duration?: number;
  rules?: Record<string, unknown>;
  sync?: boolean;
  updatedAt?: string;
}

let authCache: {
  key: string;
  token: string;
  expiresAt: number;
} | null = null;

async function getNavidromeAuth(): Promise<{ serverUrl: string; token: string }> {
  const s = useAuthStore.getState();
  const server = s.getActiveServer();
  const serverUrl = s.getBaseUrl();
  if (!serverUrl || !server?.username || !server?.password) {
    throw new Error('No active server credentials');
  }
  const key = `${serverUrl}|${server.username}|${server.password}`;
  if (authCache && authCache.key === key && Date.now() < authCache.expiresAt) {
    return { serverUrl, token: authCache.token };
  }
  const login = await ndLogin(serverUrl, server.username, server.password);
  authCache = {
    key,
    token: login.token,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  return { serverUrl, token: login.token };
}

function conditionToRule(c: SmartRuleCondition): Record<string, unknown> {
  return { [c.operator]: { [c.field]: c.value } };
}

export function buildSmartRules(conditions: SmartRuleCondition[], opts?: { limit?: number; sort?: string }) {
  const all = conditions.map(conditionToRule);
  const rules: Record<string, unknown> = { all };
  if (typeof opts?.limit === 'number' && opts.limit > 0) rules.limit = opts.limit;
  if (opts?.sort) rules.sort = opts.sort;
  return rules;
}

export async function ndListSmartPlaylists(): Promise<NdSmartPlaylist[]> {
  const { serverUrl, token } = await getNavidromeAuth();
  const raw = await invoke<unknown>('nd_list_playlists', { serverUrl, token, smart: true });
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items))
      ? (raw as { items: unknown[] }).items
      : [];
  return list.map((v) => {
    const o = (v as Record<string, unknown>) ?? {};
    return {
      id: String(o.id ?? ''),
      name: String(o.name ?? ''),
      songCount: Number(o.songCount ?? 0),
      duration: typeof o.duration === 'number' ? o.duration : undefined,
      rules: typeof o.rules === 'object' && o.rules ? (o.rules as Record<string, unknown>) : undefined,
      sync: typeof o.sync === 'boolean' ? o.sync : undefined,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
    };
  });
}

export async function ndCreateSmartPlaylist(name: string, rules: Record<string, unknown>, sync = true): Promise<NdSmartPlaylist> {
  const { serverUrl, token } = await getNavidromeAuth();
  const raw = await invoke<unknown>('nd_create_playlist', {
    serverUrl,
    token,
    body: { name, rules, sync },
  });
  const o = (raw as Record<string, unknown>) ?? {};
  return {
    id: String(o.id ?? ''),
    name: String(o.name ?? name),
    songCount: Number(o.songCount ?? 0),
    duration: typeof o.duration === 'number' ? o.duration : undefined,
    rules: typeof o.rules === 'object' && o.rules ? (o.rules as Record<string, unknown>) : undefined,
    sync: typeof o.sync === 'boolean' ? o.sync : undefined,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : undefined,
  };
}

export async function ndDeletePlaylist(id: string): Promise<void> {
  const { serverUrl, token } = await getNavidromeAuth();
  await invoke('nd_delete_playlist', { serverUrl, token, id });
}
