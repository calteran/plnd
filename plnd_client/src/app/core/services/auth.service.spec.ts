import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { PreferencesService } from './preferences.service';
import { DietaryRestrictionsService } from './dietary-restrictions.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, HttpClientTestingModule]
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should not be authenticated initially', () => {
    expect(service.isAuthenticated()).toBeFalse();
  });

  it('should be authenticated after handleCallback', () => {
    service.handleCallback('test-jwt-token');
    expect(service.isAuthenticated()).toBeTrue();
    expect(service.getToken()).toBe('test-jwt-token');
  });

  it('should clear token after logout', () => {
    service.handleCallback('test-jwt-token');
    service.logout();
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.getToken()).toBeNull();
  });

  it('getToken() returns null initially', () => {
    expect(service.getToken()).toBeNull();
  });

  it('logout() calls clearUser() on UserService', () => {
    const userService = TestBed.inject(UserService);
    spyOn(userService, 'clearUser');
    service.logout();
    expect(userService.clearUser).toHaveBeenCalled();
  });

  it('logout() calls clearPreferences() on PreferencesService', () => {
    const prefsService = TestBed.inject(PreferencesService);
    spyOn(prefsService, 'clearPreferences');
    service.logout();
    expect(prefsService.clearPreferences).toHaveBeenCalled();
  });

  it('logout() calls clear() on DietaryRestrictionsService', () => {
    const dietaryService = TestBed.inject(DietaryRestrictionsService);
    spyOn(dietaryService, 'clear');
    service.logout();
    expect(dietaryService.clear).toHaveBeenCalled();
  });

  describe('when localStorage already has a token on startup', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      localStorage.setItem('auth_token', 'pre-existing-token');
      TestBed.configureTestingModule({
        imports: [RouterTestingModule, HttpClientTestingModule]
      });
    });
    afterEach(() => { localStorage.clear(); });

    it('should be authenticated on construction', () => {
      const svc = TestBed.inject(AuthService);
      expect(svc.isAuthenticated()).toBeTrue();
      expect(svc.getToken()).toBe('pre-existing-token');
    });
  });
});
