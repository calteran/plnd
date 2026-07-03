import { readCache, writeCache } from './briefing-cache';

const STORE = 'test.cache';
const HOUR = 3_600_000;

describe('briefing-cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('returns a written value within its TTL', () => {
    writeCache(STORE, '51.5,-0.1', { t: 14 });
    vi.setSystemTime(60_000);
    expect(readCache<{ t: number }>(STORE, '51.5,-0.1', HOUR)?.v).toEqual({ t: 14 });
  });

  it('treats an expired entry as a miss', () => {
    writeCache(STORE, 'k', { t: 14 });
    vi.setSystemTime(HOUR + 1);
    expect(readCache(STORE, 'k', HOUR)).toBeNull();
  });

  it('distinguishes a cached null value from a real miss', () => {
    writeCache<string | null>(STORE, 'k', null);
    const hit = readCache<string | null>(STORE, 'k', HOUR);
    expect(hit).not.toBeNull();
    expect(hit?.v).toBeNull();
    expect(readCache(STORE, 'absent', HOUR)).toBeNull();
  });

  it('evicts the least-recently-accessed entry when over capacity', () => {
    writeCache(STORE, 'a', 1, 2);
    vi.setSystemTime(1);
    writeCache(STORE, 'b', 2, 2);
    vi.setSystemTime(2);
    readCache(STORE, 'a', HOUR); // touch 'a' → 'b' is now least-recently-used
    vi.setSystemTime(3);
    writeCache(STORE, 'c', 3, 2); // over capacity 2 → evict 'b'
    expect(readCache(STORE, 'a', HOUR)?.v).toBe(1);
    expect(readCache(STORE, 'c', HOUR)?.v).toBe(3);
    expect(readCache(STORE, 'b', HOUR)).toBeNull();
  });
});
