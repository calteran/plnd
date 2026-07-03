# Client-side Weather + City Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user's city in the briefing weather card, by moving weather (Open-Meteo) and city (BigDataCloud reverse-geocode) to direct, parallel, browser-cached client fetches and retiring the server's `/briefing/weather` proxy.

**Architecture:** Weather and city are keyless, CORS-open lookups the browser can make directly, so they move client-side as native `fetch()` calls (bypassing Angular's interceptor chain — no JWT, no `X-Request-ID` preflight, no error-log noise) fired concurrently. News (CORS-blocked RSS aggregation) and yesterday (auth + DB) stay server-side unchanged. Results are cached in `localStorage` with an access-ordered LRU. Precise coordinates are rounded to 1 dp before any third-party call (privacy jitter + cache key).

**Tech Stack:** Angular 22 (standalone components, signals, OnPush), Vitest unit tests, Playwright e2e, Rust/Axum backend (deletions only), `moka` cache (server, news only).

**Design reference:** `docs/superpowers/specs/2026-07-03-client-side-weather-city-briefing-design.md`

## Global Constraints

- **Branch discipline:** never commit to `main`; this work is on branch `worktree-weather-city-name` in worktree `.claude/worktrees/weather-city-name`. Run all git via `git -C <worktree-path>`.
- **Verification gate:** `just verify` before any commit of code (docs-only commits exempt). Run `just fmt` before `just verify` (it includes `cargo fmt --check`). `just verify` needs shared infra the **user** starts (`just persist`) — never run `persist`/`stop`/`clean`; if infra is down, notify the user and wait.
- **Angular unit tests run from the worktree:** `cd plnd_client && npx ng test` (headless Vitest). Running from repo root tests `main`, not this branch.
- **E2E naming:** test files MUST end in `.e2e.ts` or Playwright silently skips them.
- **E2E mock policy:** only genuinely-external services and LLM endpoints may be mocked (`page.route`). Open-Meteo + BigDataCloud qualify (external). News + yesterday flow through the real backend.
- **No JWT to third parties:** weather/city use native `fetch()`, never Angular `HttpClient` (which runs interceptors).
- **Coordinate jitter:** round to 1 dp before any Open-Meteo/BigDataCloud request.
- Prefer current Angular idioms (signals, `@if`/`@for`, standalone). Match surrounding style.

---

## File Structure

**Client — new:**
- `plnd_client/src/app/core/util/weather-code.ts` — pure WMO code → condition string
- `plnd_client/src/app/core/util/weather-code.spec.ts`
- `plnd_client/src/app/core/util/geo.ts` — coordinate rounding + cache-key helpers
- `plnd_client/src/app/core/util/geo.spec.ts`
- `plnd_client/src/app/core/util/briefing-cache.ts` — access-ordered LRU over `localStorage`
- `plnd_client/src/app/core/util/briefing-cache.spec.ts`

**Client — modified:**
- `plnd_client/src/app/core/services/briefing.service.ts` — client weather+city fetch, `_city` signal, cache, parallel
- `plnd_client/src/app/core/services/briefing.service.spec.ts` — mock `fetch`
- `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.ts` — render city
- `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.scss` — `.weather-city`
- `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.spec.ts` — city tests + mock `city` signal

**Server — deleted:**
- `plnd_data/src/providers/weather.rs`
- `plnd_data/src/providers/weather_fixture.rs`
- `plnd_data/fixtures/open-meteo/` (directory + `forecast.json`)

**Server — modified (removals):**
- `plnd_data/src/providers/mod.rs`
- `plnd_api/src/briefing.rs`
- `plnd_api/src/routes/briefing.rs`
- `plnd_api/src/router.rs`
- `plnd_api/src/openapi.rs`
- `plnd_api/src/providers.rs`
- `plnd_api/src/config/settings.rs` (doc comment)
- `config/api/default.toml` (dead keys)
- `justfile` (`refresh-fixtures` recipe)

**E2E — new:**
- `plnd_client/e2e/helpers/briefing-mocks.ts`
- `plnd_client/e2e/tests/briefing-weather-city.e2e.ts`

---

## Task 1: WMO weather-code → condition util

**Files:**
- Create: `plnd_client/src/app/core/util/weather-code.ts`
- Test: `plnd_client/src/app/core/util/weather-code.spec.ts`

**Interfaces:**
- Produces: `weatherCodeToCondition(code: number): string`

- [ ] **Step 1: Write the failing test**

Create `plnd_client/src/app/core/util/weather-code.spec.ts`:

```ts
import { weatherCodeToCondition } from './weather-code';

describe('weatherCodeToCondition', () => {
  it('maps clear, cloudy, fog, rain, snow, storm ranges', () => {
    expect(weatherCodeToCondition(0)).toBe('Clear sky');
    expect(weatherCodeToCondition(1)).toBe('Partly cloudy');
    expect(weatherCodeToCondition(3)).toBe('Partly cloudy');
    expect(weatherCodeToCondition(45)).toBe('Foggy');
    expect(weatherCodeToCondition(61)).toBe('Rainy');
    expect(weatherCodeToCondition(71)).toBe('Snowy');
    expect(weatherCodeToCondition(95)).toBe('Thunderstorm');
  });

  it('falls back to Cloudy for unknown codes', () => {
    expect(weatherCodeToCondition(200)).toBe('Cloudy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_client && npx ng test`
Expected: FAIL — `Cannot find module './weather-code'` (or the new spec's assertions error).

- [ ] **Step 3: Write minimal implementation**

Create `plnd_client/src/app/core/util/weather-code.ts` (ports the Rust `weather_code_to_condition` map verbatim):

```ts
/**
 * Map an Open-Meteo WMO weather interpretation code to a human-readable string.
 * Ported from the Rust `weather_code_to_condition` (plnd_data). See:
 * https://open-meteo.com/en/docs#weathervariables
 */
export function weatherCodeToCondition(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rainy';
  if (code >= 71 && code <= 86) return 'Snowy';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Cloudy';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test`
Expected: PASS (the two new `weatherCodeToCondition` specs green).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/src/app/core/util/weather-code.ts plnd_client/src/app/core/util/weather-code.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "feat(client): WMO weather-code to condition util"
```

---

## Task 2: Coordinate rounding + cache-key util

**Files:**
- Create: `plnd_client/src/app/core/util/geo.ts`
- Test: `plnd_client/src/app/core/util/geo.spec.ts`

**Interfaces:**
- Produces:
  - `roundCoord(n: number): number` — round to 1 dp (~11 km)
  - `coordStr(n: number): string` — rounded, `.toFixed(1)`
  - `locationKey(lat: number, lon: number): string` — `"<lat1dp>,<lon1dp>"`

- [ ] **Step 1: Write the failing test**

Create `plnd_client/src/app/core/util/geo.spec.ts` (values chosen to avoid IEEE-754 `.x5` rounding ambiguity):

```ts
import { roundCoord, coordStr, locationKey } from './geo';

describe('geo', () => {
  it('rounds coordinates to one decimal place', () => {
    expect(roundCoord(51.5074)).toBe(51.5);
    expect(roundCoord(45.58)).toBe(45.6);
    expect(roundCoord(-122.68)).toBe(-122.7);
  });

  it('formats a coordinate string at one decimal place', () => {
    expect(coordStr(-0.1278)).toBe('-0.1');
    expect(coordStr(45)).toBe('45.0');
  });

  it('builds a location key from lat/lon', () => {
    expect(locationKey(51.5074, -0.1278)).toBe('51.5,-0.1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_client && npx ng test`
Expected: FAIL — `Cannot find module './geo'`.

- [ ] **Step 3: Write minimal implementation**

Create `plnd_client/src/app/core/util/geo.ts`:

```ts
/** Round a coordinate to 1 decimal place (~11 km grid). Mirrors the server's
 *  former `round_location`: a privacy jitter (precise GPS never leaves the
 *  browser) and a cache-key normalizer in one. */
export const roundCoord = (n: number): number => Math.round(n * 10) / 10;

/** Rounded coordinate as a fixed 1-dp string, for URLs and keys. */
export const coordStr = (n: number): string => roundCoord(n).toFixed(1);

/** Stable cache key / `loc` param for a rounded lat/lon pair. */
export const locationKey = (lat: number, lon: number): string =>
  `${coordStr(lat)},${coordStr(lon)}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/src/app/core/util/geo.ts plnd_client/src/app/core/util/geo.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "feat(client): coordinate rounding + cache-key util"
```

---

## Task 3: Access-ordered LRU browser cache

**Files:**
- Create: `plnd_client/src/app/core/util/briefing-cache.ts`
- Test: `plnd_client/src/app/core/util/briefing-cache.spec.ts`

**Interfaces:**
- Produces:
  - `readCache<T>(store: string, key: string, ttlMs: number): { v: T } | null` — returns a hit (bumping recency) or `null` for miss/expired. A cached `null` value is a hit `{ v: null }`, distinct from a `null` miss.
  - `writeCache<T>(store: string, key: string, v: T, capacity?: number): void` — writes, then evicts least-recently-accessed beyond `capacity` (default 100).

- [ ] **Step 1: Write the failing test**

Create `plnd_client/src/app/core/util/briefing-cache.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_client && npx ng test`
Expected: FAIL — `Cannot find module './briefing-cache'`.

- [ ] **Step 3: Write minimal implementation**

Create `plnd_client/src/app/core/util/briefing-cache.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/src/app/core/util/briefing-cache.ts plnd_client/src/app/core/util/briefing-cache.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "feat(client): access-ordered LRU localStorage cache for briefing"
```

---

## Task 4: BriefingService — client-side weather + city

**Files:**
- Modify: `plnd_client/src/app/core/services/briefing.service.ts` (full rewrite of body)
- Test: `plnd_client/src/app/core/services/briefing.service.spec.ts` (full rewrite)

**Interfaces:**
- Consumes: `weatherCodeToCondition` (Task 1); `roundCoord`, `coordStr`, `locationKey` (Task 2); `readCache`, `writeCache` (Task 3); existing `WeatherSummary`, `NewsHeadline`, `YesterdaySnapshot` models; `SKIP_AUTH_ERROR`.
- Produces: `BriefingService` with an added `readonly city = signal<string | null>` accessor, alongside unchanged `weather`, `news`, `yesterday`, and their `*Error` signals and `load(date: string): void`.

- [ ] **Step 1: Write the failing test (full spec rewrite)**

Replace the entire contents of `plnd_client/src/app/core/services/briefing.service.spec.ts` with:

```ts
import { type Mock } from '../../../testing/spy';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BriefingService } from './briefing.service';
import { ConfigService } from './config.service';

const mockConfig = { api: { baseUrl: 'http://localhost:3000' } };
const TEST_LAT = 51.5;
const TEST_LON = -0.1;

const OPEN_METEO = {
  current: { temperature_2m: 14, precipitation: 5.2, weather_code: 61 },
  daily: { temperature_2m_max: [17], temperature_2m_min: [11] },
};
const BIG_DATA_CLOUD = { city: 'Testville', locality: 'Testville' };
const N = { headlines: [{ title: 'Story A' }, { title: 'Story B' }] };
const Y = { tasks_done: 4, tasks_total: 6, meals_logged: 2, meals_planned: 3 };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

describe('BriefingService', () => {
  let service: BriefingService;
  let httpMock: HttpTestingController;
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => mockConfig } },
      ],
    });
    service = TestBed.inject(BriefingService);
    httpMock = TestBed.inject(HttpTestingController);

    fetchMock = vi.fn((url: string) => {
      if (url.includes('open-meteo.com')) return Promise.resolve(jsonResponse(OPEN_METEO));
      if (url.includes('bigdatacloud.net')) return Promise.resolve(jsonResponse(BIG_DATA_CLOUD));
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(navigator.geolocation, 'getCurrentPosition').mockImplementation(
      (success: PositionCallback) => {
        success({
          coords: {
            latitude: TEST_LAT, longitude: TEST_LON, accuracy: 0,
            altitude: null, altitudeAccuracy: null, heading: null, speed: null,
          },
          timestamp: 0,
        } as GeolocationPosition);
      }
    );
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  function flushServer(newsBody: object, yesterdayBody: object) {
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/news'))
      .flush(newsBody);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(yesterdayBody);
  }

  it('sets weather signal from a direct Open-Meteo fetch', async () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(service.weather()).not.toBeNull());
    expect(service.weather()?.temperature_c).toBe(14);
    expect(service.weather()?.condition).toBe('Rainy');
    expect(service.weatherError()).toBeNull();
  });

  it('sets city signal from a direct BigDataCloud fetch', async () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(service.city()).toBe('Testville'));
  });

  it('fires weather and city in parallel with rounded coordinates', async () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.includes('open-meteo.com') && u.includes('latitude=51.5') && u.includes('longitude=-0.1'))).toBe(true);
    expect(urls.some(u => u.includes('bigdatacloud.net') && u.includes('latitude=51.5'))).toBe(true);
  });

  it('sets weatherError when the weather fetch fails; city still resolves', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('open-meteo.com')
        ? Promise.resolve({ ok: false, status: 503 } as Response)
        : Promise.resolve(jsonResponse(BIG_DATA_CLOUD)));
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(service.weatherError()).toBe('Weather unavailable'));
    expect(service.weather()).toBeNull();
    await vi.waitFor(() => expect(service.city()).toBe('Testville'));
  });

  it('omits the city silently when the city fetch fails; weather intact', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('bigdatacloud.net')
        ? Promise.reject(new Error('network'))
        : Promise.resolve(jsonResponse(OPEN_METEO)));
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(service.weather()?.temperature_c).toBe(14));
    expect(service.city()).toBeNull();
  });

  it('serves weather + city from cache with no second third-party fetch', async () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // New date resets the in-memory dedupe, but the localStorage cache is warm.
    service.load('2026-04-07');
    flushServer(N, Y);
    await vi.waitFor(() => expect(service.weather()?.temperature_c).toBe(14));
    expect(service.city()).toBe('Testville');
    expect(fetchMock).toHaveBeenCalledTimes(2); // no new Open-Meteo/BigDataCloud calls
  });

  it('sets news and yesterday from the server as before', () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    expect(service.news()).toEqual([{ title: 'Story A' }, { title: 'Story B' }]);
    expect(service.yesterday()?.tasks_done).toBe(4);
  });

  it('sets errors and skips third-party fetches when geolocation is denied', () => {
    (navigator.geolocation.getCurrentPosition as Mock).mockImplementation(
      (_s: PositionCallback, error?: PositionErrorCallback) => {
        error?.({
          code: 1, message: 'Permission denied',
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
        } as GeolocationPositionError);
      });
    service.load('2026-04-06');
    httpMock.expectOne('http://localhost:3000/briefing/yesterday').flush(Y);
    expect(service.weatherError()).toBe('Location unavailable');
    expect(service.newsError()).toBe('Location unavailable');
    expect(service.weather()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_client && npx ng test`
Expected: FAIL — `service.city` is not a function / weather never set (service still calls the server for weather).

- [ ] **Step 3: Write the implementation (full service rewrite)**

Replace the entire contents of `plnd_client/src/app/core/services/briefing.service.ts` with:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { ConfigService } from './config.service';
import { SKIP_AUTH_ERROR } from '../interceptors/auth-context-tokens';
import { NewsHeadline, WeatherSummary, YesterdaySnapshot } from '../models/briefing';
import { coordStr, locationKey } from '../util/geo';
import { weatherCodeToCondition } from '../util/weather-code';
import { readCache, writeCache } from '../util/briefing-cache';

const WEATHER_STORE = 'plnd.briefing.weather';
const CITY_STORE = 'plnd.briefing.city';
const WEATHER_TTL_MS = 60 * 60 * 1000;          // 1 hour
const CITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

interface OpenMeteoResponse {
  current: { temperature_2m: number; precipitation: number; weather_code: number };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
}
interface BigDataCloudResponse {
  city?: string;
  locality?: string;
}

@Injectable({ providedIn: 'root' })
export class BriefingService {
  private readonly http   = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _weather        = signal<WeatherSummary | null>(null);
  private readonly _city           = signal<string | null>(null);
  private readonly _news           = signal<NewsHeadline[] | null>(null);
  private readonly _yesterday      = signal<YesterdaySnapshot | null>(null);
  private readonly _weatherError   = signal<string | null>(null);
  private readonly _newsError      = signal<string | null>(null);
  private readonly _yesterdayError = signal<string | null>(null);

  readonly weather        = this._weather.asReadonly();
  readonly city           = this._city.asReadonly();
  readonly news           = this._news.asReadonly();
  readonly yesterday      = this._yesterday.asReadonly();
  readonly weatherError   = this._weatherError.asReadonly();
  readonly newsError      = this._newsError.asReadonly();
  readonly yesterdayError = this._yesterdayError.asReadonly();

  private _loadedForDate: string | null = null;

  /** Fire all briefing requests for the given calendar date. Yesterday loads
   *  unconditionally from our API; weather + city are resolved directly from
   *  third-party APIs (Open-Meteo, BigDataCloud) via native fetch — no auth
   *  header, cached in localStorage — and news from our API. All three
   *  location-based lookups fire in parallel. Location comes from browser
   *  geolocation (cached fix up to 60 s old; fresh fixes time out after 15 s);
   *  if denied, weather/news are omitted rather than erroring.
   *  No-ops when called again for the same date. */
  load(date: string): void {
    if (this._loadedForDate === date) return;
    this._loadedForDate = date;
    this._weather.set(null);
    this._city.set(null);
    this._news.set(null);
    this._yesterday.set(null);
    this._weatherError.set(null);
    this._newsError.set(null);
    this._yesterdayError.set(null);
    const base = this.config.getConfig().api.baseUrl;

    const ctx = new HttpContext().set(SKIP_AUTH_ERROR, true);

    this.http.get<YesterdaySnapshot>(`${base}/briefing/yesterday`, { context: ctx }).subscribe({
      next:  y  => { this._yesterday.set(y);  this._yesterdayError.set(null); },
      error: () => this._yesterdayError.set('Yesterday unavailable'),
    });

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this._weatherError.set('Location unavailable');
      this._newsError.set('Location unavailable');
      return;
    }

    // Angular signals are zone-agnostic, so the .set() calls inside these
    // geolocation / fetch callbacks trigger change detection correctly even
    // though they fire outside NgZone.
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latStr = coordStr(pos.coords.latitude);
        const lonStr = coordStr(pos.coords.longitude);
        const key = locationKey(pos.coords.latitude, pos.coords.longitude);

        this.loadWeather(latStr, lonStr, key);
        this.loadCity(latStr, lonStr, key);

        // News stays a server call (CORS-blocked RSS aggregation). Rounded loc.
        this.http.get<{ headlines: NewsHeadline[] }>(`${base}/briefing/news?loc=${key}`, { context: ctx }).subscribe({
          next:  n  => { this._news.set(n.headlines); this._newsError.set(null); },
          error: () => this._newsError.set('Headlines unavailable'),
        });
      },
      err => {
        console.warn('[BriefingService] geolocation error', err.code, err.message);
        this._weatherError.set('Location unavailable');
        this._newsError.set('Location unavailable');
      },
      { maximumAge: Infinity, timeout: 15_000 },
    );
  }

  /** Weather from Open-Meteo (direct fetch, cached 1 h). */
  private loadWeather(latStr: string, lonStr: string, key: string): void {
    const cached = readCache<WeatherSummary>(WEATHER_STORE, key, WEATHER_TTL_MS);
    if (cached) { this._weather.set(cached.v); this._weatherError.set(null); return; }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}`
      + `&current=temperature_2m,precipitation,weather_code`
      + `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1`;

    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<OpenMeteoResponse>; })
      .then(d => {
        const w: WeatherSummary = {
          temperature_c: d.current.temperature_2m,
          condition: weatherCodeToCondition(d.current.weather_code),
          high_c: d.daily.temperature_2m_max[0] ?? 0,
          low_c: d.daily.temperature_2m_min[0] ?? 0,
          precipitation_mm: d.current.precipitation,
        };
        this._weather.set(w);
        this._weatherError.set(null);
        writeCache(WEATHER_STORE, key, w);
      })
      .catch(() => this._weatherError.set('Weather unavailable'));
  }

  /** City from BigDataCloud reverse-geocode-client (direct fetch, cached 30 d).
   *  Failure or a blank result silently omits the label. */
  private loadCity(latStr: string, lonStr: string, key: string): void {
    const cached = readCache<string | null>(CITY_STORE, key, CITY_TTL_MS);
    if (cached) { this._city.set(cached.v); return; }

    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client`
      + `?latitude=${latStr}&longitude=${lonStr}&localityLanguage=en`;

    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<BigDataCloudResponse>; })
      .then(d => {
        const city = (d.city || d.locality || '').trim() || null;
        this._city.set(city);
        writeCache(CITY_STORE, key, city);
      })
      .catch(() => { /* omit city silently — graceful degradation */ });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test`
Expected: PASS (all BriefingService specs green).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/src/app/core/services/briefing.service.ts plnd_client/src/app/core/services/briefing.service.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "feat(client): fetch weather + city directly, parallel and cached"
```

---

## Task 5: Render the city in the briefing header

**Files:**
- Modify: `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.ts`
- Modify: `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.scss`
- Test: `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.spec.ts`

**Interfaces:**
- Consumes: `BriefingService.city()` (Task 4).

- [ ] **Step 1: Write the failing tests**

In `plnd_client/src/app/features/day-view/components/briefing-header/briefing-header.spec.ts`, update the mock factory to expose a `city` signal, then add two tests.

Change the `makeMockBriefing` signature + body — replace:

```ts
function makeMockBriefing(overrides: {
  weather?: WeatherSummary | null;
  news?: NewsHeadline[] | null;
  weatherError?: string | null;
  newsError?: string | null;
} = {}) {
  const weather      = signal(overrides.weather      ?? null);
  const news         = signal(overrides.news         ?? null);
  const weatherError = signal(overrides.weatherError ?? null);
  const newsError    = signal(overrides.newsError    ?? null);
  return {
    weather:        weather.asReadonly(),
    news:           news.asReadonly(),
    weatherError:   weatherError.asReadonly(),
    newsError:      newsError.asReadonly(),
    yesterday:      signal(null).asReadonly(),
    yesterdayError: signal(null).asReadonly(),
    load: vi.fn(),
  };
}
```

with:

```ts
function makeMockBriefing(overrides: {
  weather?: WeatherSummary | null;
  city?: string | null;
  news?: NewsHeadline[] | null;
  weatherError?: string | null;
  newsError?: string | null;
} = {}) {
  const weather      = signal(overrides.weather      ?? null);
  const city         = signal(overrides.city         ?? null);
  const news         = signal(overrides.news         ?? null);
  const weatherError = signal(overrides.weatherError ?? null);
  const newsError    = signal(overrides.newsError    ?? null);
  return {
    weather:        weather.asReadonly(),
    city:           city.asReadonly(),
    news:           news.asReadonly(),
    weatherError:   weatherError.asReadonly(),
    newsError:      newsError.asReadonly(),
    yesterday:      signal(null).asReadonly(),
    yesterdayError: signal(null).asReadonly(),
    load: vi.fn(),
  };
}
```

Then add these two tests inside `describe('BriefingHeaderComponent', ...)` (e.g. after the `'renders weather data when available'` test):

```ts
  it('renders the city name when present', async () => {
    const w: WeatherSummary = {
      temperature_c: 14, condition: 'Rainy', high_c: 17, low_c: 11, precipitation_mm: 5.2,
    };
    const f = await setup({ weather: w, city: 'Portland' });
    const city = f.debugElement.query(By.css('.weather-city'));
    expect(city).toBeTruthy();
    expect(city.nativeElement.textContent.trim()).toBe('Portland');
  });

  it('omits the city label when city is null', async () => {
    const w: WeatherSummary = {
      temperature_c: 14, condition: 'Rainy', high_c: 17, low_c: 11, precipitation_mm: 5.2,
    };
    const f = await setup({ weather: w });
    expect(f.debugElement.query(By.css('.weather-city'))).toBeFalsy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plnd_client && npx ng test`
Expected: FAIL — `.weather-city` not found (template doesn't render it yet).

- [ ] **Step 3: Add the template markup**

In `briefing-header.ts`, inside the weather `@if (briefing.weather(); as w) { <div class="weather-content"> ... }` block, add the city span as the first child of `.weather-content`. Replace:

```html
          <div class="weather-content">
            <span class="weather-temp">{{ Math.round(w.temperature_c) }}°</span>
```

with:

```html
          <div class="weather-content">
            @if (briefing.city(); as c) {
              <span class="weather-city">{{ c }}</span>
            }
            <span class="weather-temp">{{ Math.round(w.temperature_c) }}°</span>
```

- [ ] **Step 4: Add the style**

In `briefing-header.scss`, add after the `.weather-content { ... }` rule (before `.weather-temp`):

```scss
.weather-city {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd plnd_client && npx ng test`
Expected: PASS (both new header tests green; existing header + service tests still green).

- [ ] **Step 6: Verify the client end-to-end and commit**

Run: `just fmt` then `just verify ts` (isolated TS leg; needs no DB). Expected: `✅` for the TS leg. If shared infra is down and even the `ts` subset cannot run, notify the user; do not run `just persist`.

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/src/app/features/day-view/components/briefing-header/
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "feat(client): show resolved city in the weather briefing card"
```

---

## Task 6: Retire the server weather proxy

Rust deletions are interdependent (the crate won't compile with a partial removal), so this whole task is one commit. There is no "failing test first" — the test is that the codebase still compiles and every remaining test passes after removal. The one test edited is `BriefingState`'s unit test.

**Files:**
- Delete: `plnd_data/src/providers/weather.rs`, `plnd_data/src/providers/weather_fixture.rs`, `plnd_data/fixtures/open-meteo/` (dir)
- Modify: `plnd_data/src/providers/mod.rs`, `plnd_api/src/briefing.rs`, `plnd_api/src/routes/briefing.rs`, `plnd_api/src/router.rs`, `plnd_api/src/openapi.rs`, `plnd_api/src/providers.rs`, `plnd_api/src/config/settings.rs`, `config/api/default.toml`, `justfile`

- [ ] **Step 1: Delete the provider source + fixture**

```bash
cd /Users/robert/Development/plnd/.claude/worktrees/weather-city-name
git rm plnd_data/src/providers/weather.rs plnd_data/src/providers/weather_fixture.rs
git rm -r plnd_data/fixtures/open-meteo
```

- [ ] **Step 2: Remove weather exports from `plnd_data/src/providers/mod.rs`**

Delete the `weather` module decl (`pub mod weather;`), the `weather_fixture` decl and its `#[cfg(debug_assertions)]` attribute, and both `pub use` lines:

Remove:
```rust
pub mod weather;
```
```rust
#[cfg(debug_assertions)]
pub mod weather_fixture;
```
```rust
pub use weather::{OpenMeteoProvider, WeatherData, WeatherProvider};
```
```rust
#[cfg(debug_assertions)]
pub use weather_fixture::FixtureWeatherProvider;
```

- [ ] **Step 3: Slim `BriefingState` in `plnd_api/src/briefing.rs`**

Replace the entire file contents with:

```rust
use moka::future::Cache;
use plnd_data::providers::{NewsHeadline, NewsProvider};
use std::sync::Arc;
use std::time::Duration;

/// Shared briefing state stored in `AppState`.
/// All fields are `Arc`-backed so `Clone` is cheap.
#[derive(Clone)]
pub struct BriefingState {
    pub news: Arc<dyn NewsProvider>,
    /// Keyed by rounded location string: `"{lat:.1},{lon:.1}"`.
    /// TTL: 30 minutes. Shared across all users.
    pub news_cache: Cache<String, Vec<NewsHeadline>>,
}

impl BriefingState {
    pub fn new(news: Arc<dyn NewsProvider>) -> Self {
        let news_cache = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(1800))
            .build();
        Self { news, news_cache }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plnd_data::providers::{NewsQuery, NewsHeadline};

    struct EmptyNews;

    #[async_trait::async_trait]
    impl NewsProvider for EmptyNews {
        async fn headlines(
            &self,
            _query: NewsQuery,
        ) -> Result<Vec<NewsHeadline>, plnd_data::providers::ExternalProviderError> {
            Ok(vec![])
        }
    }

    #[test]
    fn briefing_state_constructs_without_panic() {
        let _state = BriefingState::new(Arc::new(EmptyNews));
    }
}
```

- [ ] **Step 4: Remove the weather handler + DTO in `plnd_api/src/routes/briefing.rs`**

Delete the `WeatherResponse` struct (the `#[derive(...)] pub struct WeatherResponse { ... }`) and its `impl From<plnd_data::providers::WeatherData> for WeatherResponse { ... }`. Delete the entire `get_weather` handler including its `#[utoipa::path(...)]` and `#[tracing::instrument(...)]` attributes (the block from `#[utoipa::path(\n    get,\n    path = "/briefing/weather",` through the closing `}` of `pub async fn get_weather`). Keep `LocQuery`, `parse_loc`, `round_location`, `get_news`, `get_yesterday`, and all existing `#[cfg(test)]` tests unchanged. Leave the top `use plnd_data::providers::{Location, NewsQuery};` import as-is (both are still used by `get_news`).

- [ ] **Step 5: Remove the route in `plnd_api/src/router.rs`**

Delete the line:
```rust
        .route("/briefing/weather", get(briefing::get_weather))
```

- [ ] **Step 6: Remove OpenAPI registrations in `plnd_api/src/openapi.rs`**

Change the briefing import (drop `WeatherResponse`):
```rust
    briefing::{NewsHeadlineResponse, NewsResponse, YesterdayResponse},
```
Delete the path line:
```rust
        crate::routes::briefing::get_weather,
```
Delete the schema line:
```rust
        WeatherResponse,
```

- [ ] **Step 7: Rebuild the briefing providers in `plnd_api/src/providers.rs`**

Fix the two import blocks — drop `FixtureWeatherProvider`, `OpenMeteoProvider`, `WeatherProvider`:
```rust
#[cfg(debug_assertions)]
use plnd_data::providers::{
    FixtureNewsProvider, FixtureNutritionProvider, TheMealDbFixtureProvider,
};
use plnd_data::providers::{
    NewsProvider, OpenFoodFactsProvider, RssFeedProvider, TheMealDbProvider, UsdaFdcProvider,
};
```

Update the call site (was `let (weather_provider, news_provider) = build_briefing_providers(external); let briefing = BriefingState::new(weather_provider, news_provider);`):
```rust
    let news_provider = build_briefing_providers(external);
    let briefing = BriefingState::new(news_provider);
```

Replace the whole `build_briefing_providers` function with a news-only version:
```rust
/// Constructs the news provider for the briefing handlers.
///
/// In debug builds, if `external.fixture_path` is set, returns a file-backed
/// implementation that reads captured RSS/Atom feeds from disk — used by e2e to
/// keep tests deterministic and offline. Otherwise (and always in release
/// builds, where the fixture impl does not exist) returns the real RSS provider.
fn build_briefing_providers(
    external: &plnd_api::config::settings::ExternalProvidersConfig,
) -> Arc<dyn NewsProvider> {
    #[cfg(debug_assertions)]
    if let Some(fixture_root) = &external.fixture_path {
        tracing::warn!(
            path = %fixture_root.display(),
            "USING FIXTURE NEWS PROVIDER for /briefing/news — debug builds only; never enable in prod"
        );
        let rss_dir = fixture_root.join("rss");
        let feed_paths: Vec<std::path::PathBuf> = std::fs::read_dir(&rss_dir)
            .unwrap_or_else(|e| {
                tracing::error!(path = %rss_dir.display(), error = %e, "failed to read fixture rss dir");
                std::process::exit(1);
            })
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("xml"))
            .collect();
        let news = FixtureNewsProvider::new(feed_paths).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to load fixture news provider");
            std::process::exit(1);
        });
        return Arc::new(news);
    }

    Arc::new(RssFeedProvider::new(&external.news_feed_urls))
}
```

- [ ] **Step 8: Update the stale doc comment in `plnd_api/src/config/settings.rs`**

Replace the `fixture_path` doc comment (lines that mention `OpenMeteoProvider`):
```rust
    /// Root directory of captured upstream fixtures. When `Some`, debug builds
    /// swap `OpenMeteoProvider` and `RssFeedProvider` for file-backed impls that
    /// read `{root}/open-meteo/forecast.json` and `{root}/rss/*.xml`. Never set
    /// in production — the fixture impls do not exist in release binaries.
```
with:
```rust
    /// Root directory of captured upstream fixtures. When `Some`, debug builds
    /// swap `RssFeedProvider` for a file-backed impl that reads `{root}/rss/*.xml`
    /// (plus nutrition/recipe fixtures). Never set in production — the fixture
    /// impls do not exist in release binaries.
```

- [ ] **Step 9: Remove dead config keys in `config/api/default.toml`**

Delete these three lines:
```toml
# WGS-84 coordinates used for Open-Meteo proxy. Defaults to London.
weather_latitude  = 51.5074
weather_longitude = -0.1278
```

- [ ] **Step 10: Remove Open-Meteo capture from the `justfile` `refresh-fixtures` recipe**

Delete the `mkdir` and the Open-Meteo `curl` lines:
```makefile
    @mkdir -p plnd_data/fixtures/open-meteo
```
```makefile
    curl -fsSL 'https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1' \
        -o plnd_data/fixtures/open-meteo/forecast.json
```
(Keep the RSS `curl` lines and `mkdir -p plnd_data/fixtures/rss`.)

- [ ] **Step 11: Format, compile, and verify the deletion**

```bash
cd /Users/robert/Development/plnd/.claude/worktrees/weather-city-name
just fmt
just verify-build
```
Expected: `just fmt` clean; `just verify-build` compiles with no errors (no lingering references to the removed types).

- [ ] **Step 12: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add -A
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "refactor(api): retire server-side weather proxy (now client-side)"
```

---

## Task 7: E2E — city + weather render from mocked providers

**Files:**
- Create: `plnd_client/e2e/helpers/briefing-mocks.ts`
- Create: `plnd_client/e2e/tests/briefing-weather-city.e2e.ts`

**Interfaces:**
- Consumes: existing `seedAuth` (`e2e/helpers/auth.ts`), `DayViewPage` (`e2e/pages/day-view.page.ts`), the `test`/`expect` fixtures (`e2e/fixtures.ts`), and the rendered `.weather-city` / `.weather-temp` classes (Task 5).
- Produces: `mockBriefingProviders(page)`, `grantGeolocation(context, coords?)`.

- [ ] **Step 1: Write the mock helper**

Create `plnd_client/e2e/helpers/briefing-mocks.ts`:

```ts
import { BrowserContext, Page } from '@playwright/test';

/** Deterministic Open-Meteo forecast (code 61 → "Rainy", 14°, 17/11). */
export const MOCK_OPEN_METEO = {
  current: { temperature_2m: 14, precipitation: 0, weather_code: 61 },
  daily: { temperature_2m_max: [17], temperature_2m_min: [11] },
};

/** Deterministic BigDataCloud reverse-geocode result. */
export const MOCK_BIGDATACLOUD = {
  city: 'Portland',
  locality: 'Portland',
  principalSubdivision: 'Oregon',
  countryName: 'United States',
};

/** Intercept the two third-party briefing lookups so e2e never hits the network.
 *  Both are genuinely-external services, so mocking them is allowed by the e2e
 *  policy (docs/architecture.md §9.7). */
export async function mockBriefingProviders(page: Page): Promise<void> {
  await page.route('**/api.open-meteo.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OPEN_METEO) }),
  );
  await page.route('**/api.bigdatacloud.net/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BIGDATACLOUD) }),
  );
}

/** Grant a fixed geolocation so the briefing service resolves a position. */
export async function grantGeolocation(
  context: BrowserContext,
  coords: { latitude: number; longitude: number } = { latitude: 45.52, longitude: -122.68 },
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
}
```

- [ ] **Step 2: Write the e2e test**

Create `plnd_client/e2e/tests/briefing-weather-city.e2e.ts`:

```ts
import { test, expect } from '../fixtures';
import { seedAuth } from '../helpers/auth';
import { grantGeolocation, mockBriefingProviders } from '../helpers/briefing-mocks';
import { DayViewPage } from '../pages/day-view.page';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

test('day-view briefing shows the resolved city alongside the weather', async ({ page, context }) => {
  // Geolocation + third-party mocks must be in place before the app fetches.
  await grantGeolocation(context);
  await mockBriefingProviders(page);

  // seedAuth completes onboarding so the /day route guard lets us through.
  await seedAuth(page);

  const dayView = new DayViewPage(page);
  await dayView.gotoDate(isoToday());
  await expect(dayView.getScheduleList()).toBeVisible();

  await expect(page.locator('.weather-city')).toHaveText('Portland');
  await expect(page.locator('.weather-temp')).toContainText('14');
});
```

- [ ] **Step 3: Run the new e2e test in isolation**

Run (requires shared infra up via `just persist`, plus the API on `:3000` per e2e setup; if infra is down, notify the user and stop):
```bash
cd /Users/robert/Development/plnd/.claude/worktrees/weather-city-name/plnd_client
npx playwright test e2e/tests/briefing-weather-city.e2e.ts
```
Expected: 1 passed. If it cannot run because infra is down, note that and defer to the full `just verify` gate below.

- [ ] **Step 4: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name add plnd_client/e2e/helpers/briefing-mocks.ts plnd_client/e2e/tests/briefing-weather-city.e2e.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/weather-city-name commit -m "test(e2e): assert city + weather render from mocked providers"
```

---

## Task 8: Full verification + PR

- [ ] **Step 1: Format**

```bash
cd /Users/robert/Development/plnd/.claude/worktrees/weather-city-name
just fmt
```

- [ ] **Step 2: Run the full gate**

```bash
just verify > /tmp/plnd-verify-weather-city.log 2>&1
```
Read the log; trust verify's own final line (`✅ All verifications passed` vs `error: recipe verify failed`), not the wrapper exit code. If infra is down (db/mock-oauth not running), verify fails fast — notify the user that infra needs starting (they run `just persist`) and wait; never run `persist` yourself.

Expected: `✅ All verifications passed`.

- [ ] **Step 3: Rebase onto origin/main, then open the PR**

```bash
cd /Users/robert/Development/plnd/.claude/worktrees/weather-city-name
git fetch origin
git rebase origin/main
```
Resolve any migration-number/collision conflicts if they arise (none expected — no migrations here). Then:
```bash
git push --force-with-lease -u origin worktree-weather-city-name
gh pr create --base main --title "Client-side weather + city briefing" --body "<summary + Closes/refs, see below>"
```
PR body should summarize: city name in the weather card; weather + city moved to parallel, cached, client-side fetches; server `/briefing/weather` proxy retired; news + yesterday unchanged. Include the 🤖 Generated-with footer.

- [ ] **Step 4: Monitor CI**

Invoke the `monitor-pr` skill to watch CI and address review comments. CI is the e2e oracle — a CI e2e failure is real even if local `just verify` was green.

---

## Self-Review (completed during planning)

**Spec coverage:**
- §2 CORS-line split → Tasks 4 (client weather+city), 6 (server news/yesterday retained, weather removed). ✅
- §4.1 native `fetch()` bypass → Task 4 `loadWeather`/`loadCity` use `fetch`, not `HttpClient`. ✅
- §4.2 coordinate jitter → Task 2 (`geo.ts`) + Task 4 (rounded coords sent to both APIs and news `loc`). ✅
- §4.3 parallel + decoupled `_city` signal → Task 4 (independent `loadWeather`/`loadCity`; parallel test). ✅
- §4.4 Open-Meteo mapping + WMO util → Tasks 1, 4. ✅
- §4.5 BigDataCloud mapping (`city || locality || null`) → Task 4 `loadCity`. ✅
- §4.6 bounded access-ordered LRU cache (fetchedAt/accessedAt, ~100, 1 h / 30 d, cache-null-vs-miss) → Task 3 + Task 4 wiring. ✅
- §4.7 render city inside weather block → Task 5. ✅
- §4.8 error handling (weather error / city silent omit / geolocation) → Task 4 tests. ✅
- §5 server deletions (exact lines) → Task 6. ✅
- §6 e2e `page.route` mocks + geolocation → Task 7. ✅
- §8 no-JWT / jitter / no-secrets → Tasks 4, 2 (fetch bypass + rounding); no new secrets. ✅
- §9 `refresh-fixtures` no longer captures Open-Meteo → Task 6 Step 10. ✅

**Placeholder scan:** none — every code step shows full content.

**Type consistency:** `weatherCodeToCondition`, `roundCoord`/`coordStr`/`locationKey`, `readCache`/`writeCache` signatures match between the util tasks (1–3) and their consumer (Task 4). The `city` signal accessor added in Task 4 matches the mock + template in Task 5. Server `BriefingState::new(news)` single-arg signature matches its call site in `providers.rs` (Task 6, Steps 3 + 7).

**Known risk (noted, not a gap):** the `roundCoord(51.55)` IEEE-754 boundary differs between JS (`51.5`) and Rust (`51.6`); the spec's grid is a jitter, not an exact parity contract, and Task 2's tests deliberately avoid `.x5` inputs.
