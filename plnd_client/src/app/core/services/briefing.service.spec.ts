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
    await vi.waitFor(() => {
      expect(service.weather()).not.toBeNull();
      expect(service.city()).not.toBeNull();
    });

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

  it('requests a bounded-age geolocation fix (not Infinity), so travel is reflected', () => {
    service.load('2026-04-06');
    flushServer(N, Y);
    const opts = (navigator.geolocation.getCurrentPosition as Mock).mock.calls[0][2] as PositionOptions;
    expect(Number.isFinite(opts.maximumAge)).toBe(true);
    expect(opts.maximumAge).toBeGreaterThan(0);
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
