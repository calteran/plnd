import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { ConfigService } from './config.service';
import { SKIP_AUTH_ERROR } from '../interceptors/auth-context-tokens';
import { NewsHeadline, WeatherSummary, YesterdaySnapshot } from '../models/briefing';

@Injectable({ providedIn: 'root' })
export class BriefingService {
  private readonly http   = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _weather        = signal<WeatherSummary | null>(null);
  private readonly _news           = signal<NewsHeadline[] | null>(null);
  private readonly _yesterday      = signal<YesterdaySnapshot | null>(null);
  private readonly _weatherError   = signal<string | null>(null);
  private readonly _newsError      = signal<string | null>(null);
  private readonly _yesterdayError = signal<string | null>(null);

  readonly weather        = this._weather.asReadonly();
  readonly news           = this._news.asReadonly();
  readonly yesterday      = this._yesterday.asReadonly();
  readonly weatherError   = this._weatherError.asReadonly();
  readonly newsError      = this._newsError.asReadonly();
  readonly yesterdayError = this._yesterdayError.asReadonly();

  private _loaded = false;

  /** Fire all briefing requests. Yesterday loads unconditionally; weather and news
   *  require a location — resolved via browser geolocation (5 s timeout). If location
   *  is denied or unavailable, weather/news are omitted rather than returning 400.
   *  No-ops if already called — prevents duplicate in-flight requests on rapid re-renders. */
  load(): void {
    if (this._loaded) return;
    this._loaded = true;
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

    // Angular signals are zone-agnostic, so the .set() calls inside these callbacks
    // trigger change detection correctly even though geolocation fires outside NgZone.
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`;

        this.http.get<WeatherSummary>(`${base}/briefing/weather?loc=${loc}`, { context: ctx }).subscribe({
          next:  w  => { this._weather.set(w);    this._weatherError.set(null); },
          error: () => this._weatherError.set('Weather unavailable'),
        });

        this.http.get<{ headlines: NewsHeadline[] }>(`${base}/briefing/news?loc=${loc}`, { context: ctx }).subscribe({
          next:  n  => { this._news.set(n.headlines); this._newsError.set(null); },
          error: () => this._newsError.set('Headlines unavailable'),
        });
      },
      () => {
        this._weatherError.set('Location unavailable');
        this._newsError.set('Location unavailable');
      },
      { timeout: 5000 },
    );
  }
}
