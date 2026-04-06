/** When true, hot-cache prefetch must not start new downloads (playback has priority). */
let deferHotCachePrefetch = false;

export function setDeferHotCachePrefetch(v: boolean): void {
  deferHotCachePrefetch = v;
}

export function getDeferHotCachePrefetch(): boolean {
  return deferHotCachePrefetch;
}
