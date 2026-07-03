# Client-side weather + city briefing — design

- **Date:** 2026-07-03
- **Status:** Approved (pending written-spec review)
- **Branch/worktree:** `.claude/worktrees/weather-city-name` (branch `worktree-weather-city-name`)

## 1. Problem

The weather card in the morning briefing shows temperature, condition, and
high/low — but no place name. Users want the **city name** shown so they trust
the reading is for *their* location ("confidence in the information").

Today the weather path carries only `lat`/`lon` end to end; there is no place
name anywhere, and no reverse-geocoding step exists. Adding one surfaced a
larger observation: the server's weather and news handlers are **proxies** — the
backend never *uses* weather or news for anything; it fetches an external API and
returns the result. That raised the question of whether these lookups belong on
the server at all.

## 2. Decision & guiding principle

The dividing line for "server vs client" is **not** "does the server use the
data" — it is **can the browser reach the source directly** (CORS) and **must a
secret stay server-side**. Sorting the three briefing lookups by that test:

| Lookup | Source | Keyless? | CORS-open? | Verdict |
|--------|--------|----------|------------|---------|
| Weather | Open-Meteo forecast | yes | yes (browser-friendly) | **move to client** |
| City | BigDataCloud `reverse-geocode-client` | yes | yes; endpoint is **client-only by TOS** | **move to client** |
| News | arbitrary RSS/Atom (xkcd, HN, Wikipedia) | yes | **no** (2 of 3 feeds send no `Access-Control-Allow-Origin`); also merges + sorts + caps | **stays server** |
| Yesterday | Postgres (auth + user data) | — | — | **stays server** |

Therefore:

- **Weather + city** move to **direct client `fetch()` calls**, fired in
  parallel. This also resolves the original request's implementation cleanly:
  BigDataCloud's reverse-geocode endpoint is *documented as client-only*, so
  calling it from the browser is how we respect their TOS — in dev and prod.
- **News + yesterday** remain server endpoints unchanged. News genuinely needs
  the server as a CORS-bypass + aggregator; yesterday needs auth + the DB.
- The server's `/briefing/weather` proxy, `WeatherProvider` stack, and weather
  cache are **removed**.

## 3. Goals / non-goals

**Goals**
- Show the user's city in the weather card, omitted gracefully on failure.
- Fetch weather and city **in parallel** (no serial dependency).
- Call the client-only BigDataCloud endpoint from the client.
- Cache weather + city in the browser (the user is usually in one place).
- Coarsen (jitter) the user's precise coordinates before they reach any third
  party, matching the server's existing 1-decimal rounding.

**Non-goals**
- Moving news client-side (CORS-blocked; out of scope).
- Region/state in the label (city only; can revisit later).
- Any change to `/briefing/yesterday`.

## 4. Client design (`plnd_client`)

### 4.1 Transport: native `fetch()`, not `HttpClient`

Third-party calls **bypass Angular's interceptor chain** and use native
`fetch()`. Rationale:

- `authInterceptor` already allowlists our API base URL, so it would not attach
  the JWT — but we do not want to *rely* solely on that for third-party hosts.
- `observabilityInterceptor` stamps `X-Request-ID` on **every** outbound request
  and reports 4xx/5xx to our backend. Sending a custom header to
  Open-Meteo/BigDataCloud would (a) trigger a CORS **preflight** those hosts may
  reject and (b) pollute our error log with third-party failures.

Using `fetch()` for these two calls (the same pattern
`observabilityInterceptor.reportError` uses to escape the chain) means: no JWT,
no custom headers, no preflight, no error-log noise. News + yesterday keep using
`HttpClient` (our API — wants auth + observability).

### 4.2 Coordinate rounding / privacy jitter

New pure helper (e.g. `core/util/geo.ts`):

```ts
export const roundCoord = (n: number): number => Math.round(n * 10) / 10; // 1 dp ≈ 11 km
export const locationKey = (lat: number, lon: number): string =>
  `${roundCoord(lat).toFixed(1)},${roundCoord(lon).toFixed(1)}`;
```

The **rounded** coordinates are used for *both* third-party requests (so the
precise GPS fix never leaves the browser) **and** as the cache key. This mirrors
the server's old `round_location` behaviour and applies it to the city lookup
too, per requirement.

### 4.3 Parallel fetch + decoupled signals

`BriefingService` gains a `_city` signal, independent of `_weather`:

```ts
private readonly _city = signal<string | null>(null);
readonly city = this._city.asReadonly();
```

Inside the existing geolocation success callback, fire **three concurrent**
requests with no ordering between them:

1. **Weather** — cache-check, else `fetch()` Open-Meteo → map → `_weather.set`, write cache.
2. **City** — cache-check, else `fetch()` BigDataCloud → map → `_city.set`, write cache.
3. **News** — unchanged `HttpClient` GET to the server.

Weather and city are fully decoupled (no merge coordination), so each renders as
soon as it arrives. `WeatherSummary` stays **weather-only** (city is its own
signal) — minimal churn.

### 4.4 Open-Meteo mapping + WMO codes

Request (rounded coords):
```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}
  &current=temperature_2m,precipitation,weather_code
  &daily=temperature_2m_max,temperature_2m_min&forecast_days=1
```
Map → `WeatherSummary`: `temperature_c=current.temperature_2m`,
`condition=weatherCodeToCondition(current.weather_code)`,
`high_c=daily.temperature_2m_max[0]`, `low_c=daily.temperature_2m_min[0]`,
`precipitation_mm=current.precipitation`.

New pure util `core/util/weather-code.ts` ports the Rust
`weather_code_to_condition` WMO map verbatim (0→"Clear sky", 1–3→"Partly cloudy",
45/48→"Foggy", 51–67→"Rainy", 71–86→"Snowy", 95–99→"Thunderstorm", else
"Cloudy"), with unit tests mirroring the Rust cases.

### 4.5 BigDataCloud mapping

Request (rounded coords):
```
https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=en
```
Map → `city = (resp.city || resp.locality || '').trim() || null`. A blank result
yields `null` (label omitted).

### 4.6 Browser cache

Small TTL cache module (e.g. `core/util/briefing-cache.ts`) backed by
`localStorage`, wrapped in `try/catch` so private-mode / SSR / quota failures
degrade to "no cache" rather than throwing.

Each cache is a **bounded multi-key store** — a JSON map of `locationKey →
{ v, ts }` under a single `localStorage` key. This lets a user who moves around
(e.g. on a phone) keep many locations warm, not just their last one; it's cheap
to store and materially helpful.

- Each entry carries **two timestamps**: `fetchedAt` (freshness — drives TTL,
  set only when data is written) and `accessedAt` (recency — bumped on every
  cache **hit**). Keeping them separate is essential: recency-on-read must
  **not** reset the TTL, or a daily-read city would never refresh past its
  30-day staleness window.
- **Access-ordered LRU:** a cache **hit** updates `accessedAt` (and persists),
  so frequently-used "favorite" locations stay resident and never re-fetch — no
  lag for the places the user actually returns to. Eviction, when a write would
  exceed capacity, removes the entry with the **oldest `accessedAt`** (least
  recently *used*, not least recently *written*).
- **Capacity:** ~100 entries per cache (mirrors the server's old moka
  `max_capacity(100)`), so a roaming phone user keeps many cities warm.
- **Weather:** entry `{ v: WeatherSummary, fetchedAt, accessedAt }`,
  **TTL 1 hour** (on `fetchedAt`; matches the server's old weather TTL).
- **City:** entry `{ v: string | null, fetchedAt, accessedAt }`,
  **TTL 30 days** (on `fetchedAt`; a coordinate's city is effectively static).
- Only **successful** responses are written (including a successful "no city"
  → `null`, so we don't re-query a genuinely nameless coordinate). A `fetch`
  error is never cached, so it retries next load.
- A cache read must distinguish **miss** (absent/expired entry → fetch) from a
  cached `null` city (hit → use it). The reader returns the entry (bumping
  `accessedAt`) or a `miss` sentinel. A TTL-expired entry is a miss and may be
  overwritten in place on the next successful fetch.

This adds cross-session, cross-date, **and cross-location** reuse on top of the
existing `_loadedForDate` in-memory dedupe (which resets on reload).

### 4.7 Rendering

`briefing-header.ts` renders the city as the **lead** of the weather card, only
when present and only inside the existing `@if (briefing.weather(); as w)` block
so it never floats on an error state:

```html
@if (briefing.city(); as c) { <span class="weather-city">{{ c }}</span> }
```
Reads e.g. **Portland · 18° Rainy · 22°/12°**. Styled subtly in
`briefing-header.scss`.

### 4.8 Error handling

- Weather `fetch` fails → existing `_weatherError.set('Weather unavailable')`.
- City `fetch` fails or returns blank → leave `_city` `null` (silently omit).
- Geolocation denied/unavailable → unchanged `'Location unavailable'`; no
  third-party call is made (so no live external hit).

## 5. Server changes (`plnd_api` / `plnd_data`) — deletions

- **`plnd_api/src/router.rs`** — remove `.route("/briefing/weather", get(briefing::get_weather))` (line ~219).
- **`plnd_api/src/routes/briefing.rs`** — remove `get_weather`, `WeatherResponse`, and its `From<WeatherData>` impl. **Keep** `parse_loc` + `round_location` (used by `get_news`) and their tests.
- **`plnd_api/src/openapi.rs`** — remove the `WeatherResponse` import (line 24), the `get_weather` path (line 84), and the `WeatherResponse` schema (line 183).
- **`plnd_api/src/briefing.rs`** — drop `weather` + `weather_cache` from `BriefingState`; keep `news` + `news_cache`. Update `BriefingState::new` signature and the `briefing_state_constructs_without_panic` unit test (remove the `AlwaysSunnyWeather` stub).
- **`plnd_api/src/providers.rs`** — `build_briefing_providers` returns only `Arc<dyn NewsProvider>`; drop weather + fixture-weather construction. Update the call site in `build`.
- **`plnd_data/src/providers/`** — delete `weather.rs` and `weather_fixture.rs`; remove `WeatherProvider`, `OpenMeteoProvider`, `WeatherData`, `FixtureWeatherProvider` from `mod.rs` (module decls + `pub use`).
- **`plnd_data/fixtures/open-meteo/`** — delete (no longer loaded).
- **`config/api/default.toml`** — remove the dead `weather_latitude` / `weather_longitude` keys (lines 50–52) and their comment. (Confirmed unused: `settings.rs` does not deserialize them.)

## 6. E2E strategy

The client now calls Open-Meteo + BigDataCloud directly, so any e2e that grants
geolocation would hit them live — against the repo's e2e mock policy (external
services **may** be mocked). Plan:

- Add a **shared helper** (e.g. `e2e/helpers/briefing.ts`) that:
  - grants a fixed geolocation on the browser context, and
  - `page.route()`-mocks `**api.open-meteo.com/**` and `**api.bigdatacloud.net/**`
    with deterministic payloads.
- Add a day-view briefing e2e asserting the **city + weather** render from those
  mocks.
- Existing e2e tests do **not** grant geolocation, so they make no third-party
  call and stay green. News stays real-backend-with-fixtures; yesterday
  unchanged.

## 7. Testing summary

- **Rust:** delete weather provider/fixture tests; update `BriefingState` test.
  `just verify rust` (+ full `just verify`) must stay green after the deletions.
- **TS unit:** `weather-code` map; `briefing-cache` TTL/miss/expiry + localStorage
  fallback; `geo` rounding/key; `BriefingService` spec (mock `fetch` — assert
  parallel dispatch, rounded coords sent, mapping, cache read/write, graceful
  omit); `briefing-header` spec (city renders / omits).
- **E2E:** new mocked day-view briefing test (above).

## 8. Security & privacy

- **No JWT to third parties:** third-party calls use `fetch()` outside the
  interceptor chain; the allowlisting `authInterceptor` is a second line of
  defence, not the only one.
- **Coordinate jitter:** precise GPS is rounded to 1 dp (~11 km) before reaching
  Open-Meteo or BigDataCloud.
- **No new secrets:** both endpoints are keyless; nothing sensitive ships to the
  client.

## 9. Follow-ups / notes

- **BigDataCloud production posture:** the keyless `reverse-geocode-client`
  endpoint is client-only by design — which is exactly why it lives on the
  client. No server-side use, so no TOS conflict. If a future need arises for
  server-side geocoding, it would require their keyed endpoint (Doppler secret) —
  tracked as a note, not part of this work.
- **`just refresh-fixtures`:** no longer needs to capture Open-Meteo (the weather
  fixture is deleted). No BigDataCloud fixture is added (client mocks live in
  e2e via `page.route`). Update the recipe/docs accordingly if they enumerate
  weather.
- Open a tracking issue for anything intentionally deferred (none identified
  beyond the above).
