import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PreferencesService } from './preferences.service';
import { UserPreferences } from '../models/preferences';

const mockPrefs: UserPreferences = {
  user_id: 'test-uuid',
  theme: 'system',
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

  it('updatePreferences updates the signal', () => {
    const updated: UserPreferences = { ...mockPrefs, theme: 'dark' };

    let result: UserPreferences | undefined;
    service.updatePreferences({ theme: 'dark' }).subscribe(p => (result = p));

    const req = httpMock.expectOne(r => r.url.endsWith('/preferences/me') && r.method === 'PATCH');
    req.flush(updated);

    expect(result).toEqual(updated);
    expect(service.preferences()).toEqual(updated);
  });

  it('clearPreferences resets to null', () => {
    service.loadPreferences();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    expect(service.preferences()).toEqual(mockPrefs);

    service.clearPreferences();
    expect(service.preferences()).toBeNull();
  });
});
