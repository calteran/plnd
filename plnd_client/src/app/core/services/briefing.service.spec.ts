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

describe('BriefingService', () => {
  let service: BriefingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => mockConfig } },
      ],
    });
    service = TestBed.inject(BriefingService);
    httpMock = TestBed.inject(HttpTestingController);

    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake(
      (success: PositionCallback) => {
        success({
          coords: {
            latitude: TEST_LAT,
            longitude: TEST_LON,
            accuracy: 0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: 0,
        } as GeolocationPosition);
      }
    );
  });

  afterEach(() => httpMock.verify());

  function flushAll(weatherBody: object, newsBody: object, yesterdayBody: object) {
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/weather'))
      .flush(weatherBody);
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/news'))
      .flush(newsBody);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(yesterdayBody);
  }

  const W = { temperature_c: 14, condition: 'Rainy', high_c: 17, low_c: 11, precipitation_mm: 5.2 };
  const N = { headlines: [{ title: 'Story A' }, { title: 'Story B' }] };
  const Y = { tasks_done: 4, tasks_total: 6, meals_logged: 2, meals_planned: 3 };

  it('sets weather signal on successful fetch', () => {
    service.load();
    flushAll(W, N, Y);
    expect(service.weather()?.temperature_c).toBe(14);
    expect(service.weatherError()).toBeNull();
  });

  it('sets news signal on successful fetch', () => {
    service.load();
    flushAll(W, N, Y);
    expect(service.news()).toEqual([{ title: 'Story A' }, { title: 'Story B' }]);
    expect(service.newsError()).toBeNull();
  });

  it('sets yesterday signal on successful fetch', () => {
    service.load();
    flushAll(W, N, Y);
    expect(service.yesterday()?.tasks_done).toBe(4);
    expect(service.yesterdayError()).toBeNull();
  });

  it('sets weatherError and leaves news intact when weather fails', () => {
    service.load();
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/weather'))
      .error(new ErrorEvent('Network error'));
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/news'))
      .flush(N);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(Y);
    expect(service.weatherError()).toBe('Weather unavailable');
    expect(service.weather()).toBeNull();
    expect(service.news()).toEqual([{ title: 'Story A' }, { title: 'Story B' }]);
  });

  it('sets newsError and leaves weather intact when news fails', () => {
    service.load();
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/weather'))
      .flush(W);
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/news'))
      .error(new ErrorEvent('Network error'));
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(Y);
    expect(service.newsError()).toBe('Headlines unavailable');
    expect(service.weather()?.temperature_c).toBe(14);
  });

  it('does not fire duplicate requests when load() is called twice', () => {
    service.load();
    service.load(); // should be a no-op
    flushAll(W, N, Y);
    expect(service.weather()?.temperature_c).toBe(14);
  });

  it('sets yesterdayError when yesterday fails', () => {
    service.load();
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/weather'))
      .flush(W);
    httpMock
      .expectOne(req => req.url.startsWith('http://localhost:3000/briefing/news'))
      .flush(N);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .error(new ErrorEvent('Network error'));
    expect(service.yesterdayError()).toBe('Yesterday unavailable');
    expect(service.yesterday()).toBeNull();
  });

  it('sets weatherError and newsError when geolocation is denied', () => {
    (navigator.geolocation.getCurrentPosition as jasmine.Spy).and.callFake(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({
          code: 1, message: 'Permission denied',
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
        } as GeolocationPositionError);
      }
    );
    service.load();
    httpMock.expectOne('http://localhost:3000/briefing/yesterday').flush(Y);
    expect(service.weatherError()).toBe('Location unavailable');
    expect(service.newsError()).toBe('Location unavailable');
    expect(service.weather()).toBeNull();
    expect(service.news()).toBeNull();
  });
});
