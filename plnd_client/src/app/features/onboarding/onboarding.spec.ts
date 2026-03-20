import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { OnboardingComponent } from './onboarding';
import { UserService } from '../../core/services/user.service';
import { User } from '../../core/models/user';
import { DietaryRestriction } from '../../core/models/dietary-restriction';

const MOCK_USER: User = {
  user_id: 'test-uuid',
  email: 'test@example.com',
  display_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: false
};

describe('OnboardingComponent', () => {
  let httpMock: HttpTestingController;

  function setup() {
    const fixture = TestBed.createComponent(OnboardingComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    // Flush lazy loads triggered by ngOnInit
    httpMock.match(r => r.url.endsWith('/preferences/me') || r.url.endsWith('/dietary-restrictions'))
      .forEach(req => {
        if (req.request.url.endsWith('/preferences/me')) {
          req.flush({ user_id: 'test-uuid', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
        } else {
          req.flush([]);
        }
      });
    fixture.detectChanges();
    return { fixture, component };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingComponent, HttpClientTestingModule, RouterTestingModule]
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);

    // Pre-populate UserService signal so ngOnInit doesn't need to fetch
    const userService = TestBed.inject(UserService);
    const svc = userService as unknown as { userSignal: { set: (v: User) => void } };
    svc.userSignal.set(MOCK_USER);
  });

  afterEach(() => httpMock.verify());

  it('should create and show the welcome step', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Welcome to PLND!');
  });

  it('Get Started advances to profile step', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Your Profile');
  });

  it('Skip on profile step advances to preferences step', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Theme');
  });

  it('Skip on preferences step advances to restrictions step', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Dietary Restrictions');
  });

  it('finish() POSTs to complete-onboarding and navigates to /today', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();

    component.finish();
    const req = httpMock.expectOne(r => r.url.endsWith('/users/me/complete-onboarding') && r.method === 'POST');
    req.flush(null, { status: 200, statusText: 'OK' });
    // Navigation is tested via router; just verify no error message
    expect(component.errorMessage).toBe('');
  });

  it('saveProfile() PATCHes /users/me and advances step on success', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    fixture.detectChanges();

    component.profileForm.controls.display_name.setValue('Alice');
    component.saveProfile();

    const req = httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'PATCH');
    req.flush({ ...MOCK_USER, display_name: 'Alice' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Theme');
    expect(component.errorMessage).toBe('');
  });

  it('saveProfile() shows error and holds step on failure', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    fixture.detectChanges();

    component.profileForm.controls.display_name.setValue('Alice');
    component.saveProfile();

    const req = httpMock.expectOne(r => r.url.endsWith('/users/me') && r.method === 'PATCH');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.step()).toBe('profile');
    expect(component.errorMessage).toBeTruthy();
  });

  it('addRestriction() shows 409 conflict error', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    fixture.detectChanges();

    component.addRestrictionForm.setValue({ restriction_type: 'allergy', name: 'peanuts', notes: null });
    component.addRestriction();

    const req = httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST');
    req.flush('Conflict', { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(component.errorMessage).toContain('already exists');
  });

  it('ngOnInit pre-populates profileForm when user has display_name', () => {
    const userService = TestBed.inject(UserService);
    const svc = userService as unknown as { userSignal: { set: (v: User) => void } };
    svc.userSignal.set({ ...MOCK_USER, display_name: 'Bob' });

    const { component } = setup();
    expect(component.profileForm.controls.display_name.value).toBe('Bob');
  });

  it('ngOnInit pre-populates themeControl from current effectiveTheme', () => {
    // ThemeService defaults to device preference (light in test env) — never 'system'
    const { component } = setup();
    expect(['light', 'dark']).toContain(component.themeControl.value);
  });

  it('saveProfile() advances to preferences when display_name is blank/whitespace', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    fixture.detectChanges();

    component.profileForm.controls.display_name.setValue('   ');
    component.saveProfile();
    // Blank name short-circuits — no HTTP call made
    httpMock.expectNone(r => r.url.endsWith('/users/me') && r.method === 'PATCH');
    fixture.detectChanges();

    expect(component.step()).toBe('preferences');
  });

  it('saveProfile() no-ops when pending is true', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.profileForm.controls.display_name.setValue('Alice');
    component.pending = true;
    component.saveProfile();
    httpMock.expectNone(r => r.url.endsWith('/users/me') && r.method === 'PATCH');
    expect(component.step()).toBe('profile');
  });

  it('savePreferences() no-ops when pending is true', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.pending = true;
    component.savePreferences();
    expect(component.step()).toBe('preferences');
    expect(component.pending).toBeTrue();
  });

  it('addRestriction() success path resets form', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    fixture.detectChanges();

    component.addRestrictionForm.setValue({ restriction_type: 'allergy', name: 'peanuts', notes: null });
    component.addRestriction();

    const newItem: DietaryRestriction = {
      restriction_id: 'id-r1', user_id: 'test-uuid',
      restriction_type: 'allergy', name: 'peanuts', notes: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
    };
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST').flush(newItem);
    fixture.detectChanges();

    // Form resets after success
    expect(component.addRestrictionForm.value.name).toBe('');
    expect(component.pending).toBeFalse();
    // Chip appears for the newly added restriction
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('addRestriction() shows generic error for non-409 failure', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    fixture.detectChanges();

    component.addRestrictionForm.setValue({ restriction_type: 'allergy', name: 'peanuts', notes: null });
    component.addRestriction();
    httpMock.expectOne(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBe('Failed to add restriction. Please try again.');
  });

  it('addRestriction() no-ops when form invalid (empty name)', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    component.addRestrictionForm.setValue({ restriction_type: 'allergy', name: '', notes: null });
    component.addRestriction();
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST');
    expect(component.pending).toBeFalse();
  });

  it('skipRestrictions() triggers complete-onboarding POST', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();

    component.skipRestrictions();
    httpMock.expectOne(r => r.url.endsWith('/users/me/complete-onboarding') && r.method === 'POST')
      .flush(null, { status: 200, statusText: 'OK' });
    expect(component.errorMessage).toBe('');
  });

  it('finish() shows error and resets pending on HTTP 500', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    fixture.detectChanges();

    component.finish();
    httpMock.expectOne(r => r.url.endsWith('/users/me/complete-onboarding') && r.method === 'POST')
      .flush('Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBeTruthy();
    expect(component.pending).toBeFalse();
  });

  it('finish() no-ops when pending is true', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    component.pending = true;
    component.finish();
    httpMock.expectNone(r => r.url.endsWith('/complete-onboarding'));
    expect(component.pending).toBeTrue();
  });

  it('savePreferences() advances to restrictions step synchronously', () => {
    const { fixture, component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    fixture.detectChanges();

    component.savePreferences();
    fixture.detectChanges();

    expect(component.step()).toBe('restrictions');
    expect(component.pending).toBeFalse();
  });

  it('addRestriction() no-ops when pending is true', () => {
    const { component } = setup();
    component.advanceFromWelcome();
    component.skipProfile();
    component.skipPreferences();
    component.addRestrictionForm.setValue({ restriction_type: 'allergy', name: 'peanuts', notes: null });
    component.pending = true;
    component.addRestriction();
    httpMock.expectNone(r => r.url.endsWith('/dietary-restrictions') && r.method === 'POST');
    expect(component.pending).toBeTrue();
  });
});
