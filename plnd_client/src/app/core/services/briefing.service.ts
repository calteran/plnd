import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from './config.service';
import { WeatherSummary, YesterdaySnapshot } from '../models/briefing';

@Injectable({ providedIn: 'root' })
export class BriefingService {
  private readonly http   = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly _weather        = signal<WeatherSummary | null>(null);
  private readonly _news           = signal<string[] | null>(null);
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

  /** Fire all three briefing requests in parallel. Each section fails independently. */
  load(): void {
    const base = this.config.getConfig().api.baseUrl;

    this.http.get<WeatherSummary>(`${base}/briefing/weather`).subscribe({
      next:  w  => { this._weather.set(w);    this._weatherError.set(null); },
      error: () => this._weatherError.set('Weather unavailable'),
    });

    this.http.get<{ headlines: string[] }>(`${base}/briefing/news`).subscribe({
      next:  n  => { this._news.set(n.headlines); this._newsError.set(null); },
      error: () => this._newsError.set('Headlines unavailable'),
    });

    this.http.get<YesterdaySnapshot>(`${base}/briefing/yesterday`).subscribe({
      next:  y  => { this._yesterday.set(y);  this._yesterdayError.set(null); },
      error: () => this._yesterdayError.set('Yesterday unavailable'),
    });
  }
}
