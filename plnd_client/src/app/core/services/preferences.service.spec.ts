import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PreferencesService } from './preferences.service';
import { UserPreferences } from '../models/preferences';

const mockPrefs: UserPreferences = {
  user_id: 'test-uuid',
  week_start_day: 0,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

describe('PreferencesService', () => {
  let service: PreferencesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(PreferencesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('loadPreferences sets the signal', () => {
    expect(service.preferences()).toBeNull();
    service.loadPreferences();
    const req = httpMock.expectOne(r => r.url.endsWith('/preferences/me') && r.method === 'GET');
    req.flush(mockPrefs);
    expect(service.preferences()).toEqual(mockPrefs);
  });

  it('loadPreferences no-ops when already loaded', () => {
    service.loadPreferences();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    service.loadPreferences();
    httpMock.expectNone(r => r.url.endsWith('/preferences/me'));
    expect(service.preferences()).toEqual(mockPrefs);
  });

  it('clearPreferences resets to null', () => {
    service.loadPreferences();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    service.clearPreferences();
    expect(service.preferences()).toBeNull();
  });
});
