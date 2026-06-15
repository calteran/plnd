import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { OAuthModule } from 'angular-oauth2-oidc';
import { MainLayoutComponent } from './main-layout';
import { AuthService } from '../../core/services/auth.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { ConfigService } from '../../core/services/config.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { WeekPlanService } from '../../core/services/week-plan.service';
import { UserService } from '../../core/services/user.service';
import { EnvironmentConfig } from '../../core/models/config';

// ── Existing smoke tests (use real OAuthModule) ──────────────────────────────

describe('MainLayoutComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent, OAuthModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();
  });

  it('should create', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.componentInstance).toBeTruthy();
  });

  it('renders the sidebar with a Today nav item', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    const sidebar = f.debugElement.query(By.css('.sidebar'));
    expect(sidebar).toBeTruthy();
    expect(sidebar.nativeElement.textContent).toContain('📅');
  });

  it('renders the bottom tabs', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('.bottom-tabs'))).toBeTruthy();
  });

  it('renders the router outlet', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('router-outlet'))).toBeTruthy();
  });
});

// ── Device-zone reporting + standoff banner ───────────────────────────────────

const API_BASE = 'http://api.test';

const mockConfig: EnvironmentConfig = {
  production: false,
  api: { baseUrl: API_BASE, timeout: 30000 },
  database: { url: '' },
  logging: { level: 'error', prettyPrint: false },
  oidc: {
    issuerUrl: '',
    clientId: '',
    redirectUri: '',
    scope: '',
    strictDiscoveryDocumentValidation: false,
  },
};

/** Minimal AuthService stub — isAuthenticated is a plain function matching the computed() API. */
const authStub = { isAuthenticated: () => true };

/** Minimal PreferencesService stub — loadPreferences is a no-op; preferences() returns null (skip effect). */
const prefsStub = { loadPreferences: () => {}, preferences: () => null };

/** Minimal WeekPlanService stub. */
const weekPlanStub = {
  hasUnplannedHorizon: () => false,
  checkPlanStatus: () => {},
};

/** Minimal UserService stub — loadUser is a no-op so no /users/me request fires. */
const userStub = { user: () => null, loadUser: () => {} };

describe('MainLayoutComponent — device-zone / standoff', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: authStub },
        { provide: ConfigService, useValue: { getConfig: () => mockConfig } },
        { provide: PreferencesService, useValue: prefsStub },
        { provide: WeekPlanService, useValue: weekPlanStub },
        { provide: UserService, useValue: userStub },
        TimezoneService,
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs to /timezone/device on init when authenticated', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    const req = httpMock.expectOne(`${API_BASE}/timezone/device`);
    expect(req.request.method).toBe('POST');
    req.flush({ outcome: 'no_change', effective_zone: 'America/Denver', confirm: null });
  });

  it('renders app-timezone-standoff when standoff is returned', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();

    const req = httpMock.expectOne(`${API_BASE}/timezone/device`);
    req.flush({
      outcome: 'standoff',
      effective_zone: 'America/New_York',
      confirm: { intended_zone: 'America/New_York', device_zone: 'America/Denver' },
    });

    f.detectChanges();
    expect(f.debugElement.query(By.css('app-timezone-standoff'))).toBeTruthy();
  });

  it('hides app-timezone-standoff after dismissStandoff resolves (clockOff path)', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();

    // Trigger standoff
    const reportReq = httpMock.expectOne(`${API_BASE}/timezone/device`);
    reportReq.flush({
      outcome: 'standoff',
      effective_zone: 'America/New_York',
      confirm: { intended_zone: 'America/New_York', device_zone: 'America/Denver' },
    });
    f.detectChanges();

    // Dismiss via clockOff
    f.componentInstance.onClockOff();
    const dismissReq = httpMock.expectOne(`${API_BASE}/timezone/standoff/dismiss`);
    dismissReq.flush(null);
    f.detectChanges();

    expect(f.debugElement.query(By.css('app-timezone-standoff'))).toBeNull();
  });

  it('hides app-timezone-standoff after createAnchor resolves (moved path)', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();

    const reportReq = httpMock.expectOne(`${API_BASE}/timezone/device`);
    const confirm = { intended_zone: 'America/New_York', device_zone: 'America/Denver' };
    reportReq.flush({ outcome: 'standoff', effective_zone: 'America/New_York', confirm });
    f.detectChanges();

    // Confirm move
    f.componentInstance.onMoved(confirm);
    const anchorReq = httpMock.expectOne(`${API_BASE}/timezone/anchors`);
    anchorReq.flush({ id: '1', user_id: 'u1', effective_date: '2026-06-15', effective_time: null,
      zone: 'America/Denver', source: 'user', source_ref: null,
      inference_group: null, created_at: '', updated_at: '' });
    f.detectChanges();

    expect(f.debugElement.query(By.css('app-timezone-standoff'))).toBeNull();
  });
});
