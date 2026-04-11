import { invoke } from '@tauri-apps/api/core';

/** Fetches a synced LRC string from Netease Cloud Music via Rust proxy. Returns null if not found. */
export async function fetchNeteaselyrics(artist: string, title: string): Promise<string | null> {
  try {
    return await invoke<string | null>('fetch_netease_lyrics', { artist, title });
  } catch {
    return null;
  }
}
