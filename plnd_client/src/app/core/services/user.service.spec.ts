import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { UserService } from './user.service';
import { User } from '../models/user';

const mockUser: User = {
  user_id: 'test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: false
};

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('loadUser sets the user signal', () => {
    expect(service.user()).toBeNull();

    service.loadUser();

    const req = httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'GET');
    req.flush(mockUser);

    expect(service.user()).toEqual(mockUser);
  });

  it('loadUser no-ops when user is already loaded', () => {
    service.loadUser();
    httpMock.expectOne(r => r.url.endsWith('/users/me')).flush(mockUser);

    // Second call should not trigger another request
    service.loadUser();
    httpMock.expectNone(r => r.url.endsWith('/users/me'));

    expect(service.user()).toEqual(mockUser);
  });

  it('updateUser updates the signal and returns the updated user', () => {
    const updated: User = { ...mockUser, display_name: 'Updated Name' };

    let result: User | undefined;
    service.updateUser({ display_name: 'Updated Name' }).subscribe(u => (result = u));

    const req = httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'PATCH');
    req.flush(updated);

    expect(result).toEqual(updated);
    expect(service.user()).toEqual(updated);
  });

  it('clearUser resets the signal to null', () => {
    service.loadUser();
    httpMock.expectOne(r => r.url.endsWith('/users/me')).flush(mockUser);
    expect(service.user()).toEqual(mockUser);

    service.clearUser();
    expect(service.user()).toBeNull();
  });

  it('fetchUser() makes HTTP request even when signal already has a user', () => {
    // Load user first so signal is populated
    service.loadUser();
    httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'GET').flush(mockUser);
    expect(service.user()).toEqual(mockUser);

    // fetchUser() bypasses the no-op guard and always fetches
    service.fetchUser().subscribe();
    const req = httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'GET');
    req.flush(mockUser);
  });

  it('completeOnboarding() POSTs and updates onboarding_completed to true', () => {
    service.loadUser();
    httpMock.expectOne(r => r.url.endsWith('/users/me')).flush(mockUser);

    service.completeOnboarding().subscribe();
    httpMock.expectOne(r => r.url.endsWith('/users/me/complete-onboarding') && r.method === 'POST')
      .flush(null, { status: 200, statusText: 'OK' });

    expect(service.user()?.onboarding_completed).toBeTrue();
  });

  it('completeOnboarding() tap does not crash when user signal is null', () => {
    // userSignal is null (no loadUser call); tap's if (u) guard covers this branch
    service.completeOnboarding().subscribe();
    httpMock.expectOne(r => r.url.endsWith('/users/me/complete-onboarding') && r.method === 'POST')
      .flush(null, { status: 200, statusText: 'OK' });

    expect(service.user()).toBeNull();
  });

  it('loadUser() handles HTTP error without crashing', () => {
    spyOn(console, 'error');
    service.loadUser();
    httpMock.expectOne(r => r.url.endsWith('/users/me'))
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(console.error).toHaveBeenCalled();
    expect(service.user()).toBeNull();
  });
});
