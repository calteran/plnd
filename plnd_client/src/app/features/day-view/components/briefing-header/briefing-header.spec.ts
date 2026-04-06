import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { BriefingHeaderComponent } from './briefing-header';
import { BriefingService } from '../../../../core/services/briefing.service';
import type { NewsHeadline, WeatherSummary } from '../../../../core/models/briefing';

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
    load: jasmine.createSpy('load'),
  };
}

describe('BriefingHeaderComponent', () => {
  async function setup(overrides = {}) {
    const briefing = makeMockBriefing(overrides);
    await TestBed.configureTestingModule({
      imports: [BriefingHeaderComponent],
      providers: [{ provide: BriefingService, useValue: briefing }],
    }).compileComponents();
    const f = TestBed.createComponent(BriefingHeaderComponent);
    f.detectChanges();
    return f;
  }

  it('renders weather data when available', async () => {
    const w: WeatherSummary = {
      temperature_c: 14, condition: 'Rainy', high_c: 17, low_c: 11, precipitation_mm: 5.2,
    };
    const f = await setup({ weather: w });
    expect(f.nativeElement.textContent).toContain('14');
    expect(f.nativeElement.textContent).toContain('Rainy');
  });

  it('renders weather unavailable state when weatherError is set', async () => {
    const f = await setup({ weatherError: 'Weather unavailable' });
    expect(f.nativeElement.textContent).toContain('Weather unavailable');
    expect(f.debugElement.query(By.css('.weather-content'))).toBeFalsy();
  });

  it('renders news headlines when available', async () => {
    const f = await setup({ news: [{ title: 'Story A' }, { title: 'Story B' }] });
    expect(f.nativeElement.textContent).toContain('Story A');
    expect(f.nativeElement.textContent).toContain('Story B');
  });

  it('renders news unavailable state when newsError is set', async () => {
    const f = await setup({ newsError: 'Headlines unavailable' });
    expect(f.nativeElement.textContent).toContain('Headlines unavailable');
    expect(f.debugElement.query(By.css('.news-content'))).toBeFalsy();
  });

  it('renders two cards side by side', async () => {
    const f = await setup();
    const cards = f.debugElement.queryAll(By.css('.briefing-card'));
    expect(cards.length).toBe(2);
  });
});
