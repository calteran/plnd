import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BriefingService } from './briefing.service';
import { ConfigService } from './config.service';

const mockConfig = { api: { baseUrl: 'http://localhost:3000' } };

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
  });

  afterEach(() => httpMock.verify());

  function flushAll(weatherBody: object, newsBody: object, yesterdayBody: object) {
    httpMock
      .expectOne('http://localhost:3000/briefing/weather')
      .flush(weatherBody);
    httpMock
      .expectOne('http://localhost:3000/briefing/news')
      .flush(newsBody);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(yesterdayBody);
  }

  const W = { temp_c: 14, condition: 'Rainy', high_c: 17, low_c: 11, precipitation_flag: true };
  const N = { headlines: ['Story A', 'Story B'] };
  const Y = { tasks_done: 4, tasks_total: 6, meals_logged: 2, meals_planned: 3 };

  it('sets weather signal on successful fetch', () => {
    service.load();
    flushAll(W, N, Y);
    expect(service.weather()?.temp_c).toBe(14);
    expect(service.weatherError()).toBeNull();
  });

  it('sets news signal on successful fetch', () => {
    service.load();
    flushAll(W, N, Y);
    expect(service.news()).toEqual(['Story A', 'Story B']);
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
      .expectOne('http://localhost:3000/briefing/weather')
      .error(new ErrorEvent('Network error'));
    httpMock
      .expectOne('http://localhost:3000/briefing/news')
      .flush(N);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(Y);
    expect(service.weatherError()).toBe('Weather unavailable');
    expect(service.weather()).toBeNull();
    expect(service.news()).toEqual(['Story A', 'Story B']);
  });

  it('sets newsError and leaves weather intact when news fails', () => {
    service.load();
    httpMock
      .expectOne('http://localhost:3000/briefing/weather')
      .flush(W);
    httpMock
      .expectOne('http://localhost:3000/briefing/news')
      .error(new ErrorEvent('Network error'));
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .flush(Y);
    expect(service.newsError()).toBe('Headlines unavailable');
    expect(service.weather()?.temp_c).toBe(14);
  });

  it('sets yesterdayError when yesterday fails', () => {
    service.load();
    httpMock
      .expectOne('http://localhost:3000/briefing/weather')
      .flush(W);
    httpMock
      .expectOne('http://localhost:3000/briefing/news')
      .flush(N);
    httpMock
      .expectOne('http://localhost:3000/briefing/yesterday')
      .error(new ErrorEvent('Network error'));
    expect(service.yesterdayError()).toBe('Yesterday unavailable');
    expect(service.yesterday()).toBeNull();
  });
});
