/**
 * Bounded, access-ordered LRU cache over `localStorage`, one JSON map per store.
 *
 * Each entry carries two timestamps: `fetchedAt` (freshness — drives TTL, set
 * only on write) and `accessedAt` (recency — bumped on every hit). Keeping them
 * separate means a frequently-read entry stays resident (never re-fetched) yet
 * still refreshes once its TTL lapses.
 */
interface CacheEntry<T> {
  v: T;
  fetchedAt: number;
  accessedAt: number;
}
type CacheMap<T> = Record<string, CacheEntry<T>>;

const DEFAULT_CAPACITY = 100;

function readStore<T>(store: string): CacheMap<T> {
  try {
    const raw = localStorage.getItem(store);
    return raw ? (JSON.parse(raw) as CacheMap<T>) : {};
  } catch {
    return {}; // SSR / private mode / corrupt JSON → behave as empty cache
  }
}

function writeStore<T>(store: string, map: CacheMap<T>): void {
  try {
    localStorage.setItem(store, JSON.stringify(map));
  } catch {
    /* quota / disabled — degrade to no cache */
  }
}

/** Return a hit (bumping recency) or `null` for a miss/expired entry. */
export function readCache<T>(store: string, key: string, ttlMs: number): { v: T } | null {
  const map = readStore<T>(store);
  const entry = map[key];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= ttlMs) return null;
  entry.accessedAt = Date.now();
  writeStore(store, map);
  return { v: entry.v };
}

/** Write a value, then evict least-recently-accessed entries beyond `capacity`. */
export function writeCache<T>(
  store: string,
  key: string,
  v: T,
  capacity = DEFAULT_CAPACITY,
): void {
  const map = readStore<T>(store);
  const now = Date.now();
  map[key] = { v, fetchedAt: now, accessedAt: now };
  const keys = Object.keys(map);
  if (keys.length > capacity) {
    keys
      .sort((a, b) => map[a].accessedAt - map[b].accessedAt)
      .slice(0, keys.length - capacity)
      .forEach(k => delete map[k]);
  }
  writeStore(store, map);
}
