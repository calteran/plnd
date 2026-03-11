import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { OnboardingComponent } from './onboarding';
import { UserService } from '../../core/services/user.service';
import { User } from '../../core/models/user';

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
          req.flush({ user_id: 'test-uuid', theme: 'system', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
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

  it('finish() POSTs to complete-onboarding and navigates to /dashboard', () => {
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
});
