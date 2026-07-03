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
