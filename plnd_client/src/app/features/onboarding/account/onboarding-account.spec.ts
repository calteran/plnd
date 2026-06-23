import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { OnboardingAccountComponent } from './onboarding-account';
import { OnboardingStateService } from '../onboarding-state.service';
import { UserService } from '../../../core/services/user.service';
import { PreferencesService } from '../../../core/services/preferences.service';
import { User } from '../../../core/models/user';

function makeUserServiceMock(displayName: string | null = 'Alice', email = 'alice@example.com') {
  return {
    user: signal<User | null>({
      user_id: '1',
      display_name: displayName,
      email,
      avatar_url: null,
      is_active: true,
      last_login: null,
      onboarding_completed: false,
      created_at: '',
      updated_at: '',
    }).asReadonly(),
    loadUser: vi.fn(),
    updateUser: vi.fn().mockReturnValue(of({})),
  };
}

function makePrefsServiceMock() {
  return {
    preferences: signal({
      user_id: '1',
      week_start_day: 1,
      planning_trigger_offset: -1,
      default_plan_length_days: 14,
      email_notifications_enabled: false,
      sms_notifications_enabled: false,
      push_notifications_enabled: false,
      phone_number: null,
      created_at: '',
      updated_at: '',
    }).asReadonly(),
    loadPreferences: vi.fn(),
    patchPreferences: vi.fn().mockReturnValue(of({})),
  };
}

function makeStateMock() {
  return {
    markComplete: vi.fn(),
  };
}

describe('OnboardingAccountComponent', () => {
  let fixture: ComponentFixture<OnboardingAccountComponent>;
  let userMock: ReturnType<typeof makeUserServiceMock>;
  let prefsMock: ReturnType<typeof makePrefsServiceMock>;
  let stateMock: ReturnType<typeof makeStateMock>;
  let router: Router;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    userMock = makeUserServiceMock();
    prefsMock = makePrefsServiceMock();
    stateMock = makeStateMock();

    await TestBed.configureTestingModule({
      imports: [OnboardingAccountComponent],
      providers: [
        { provide: UserService, useValue: userMock },
        { provide: PreferencesService, useValue: prefsMock },
        { provide: OnboardingStateService, useValue: stateMock },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OnboardingAccountComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    // Drain any pending requests (e.g. the fire-and-forget device-zone POST) so
    // verify() does not flag them as unexpected.
    httpMock.match(() => true).forEach(r => r.flush({}));
    httpMock.verify();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders pre-filled display name', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#displayName');
    expect(input.value).toBe('Alice');
  });

  it('renders pre-filled email', () => {
    const el: HTMLElement = fixture.nativeElement.querySelector('.email-display');
    expect(el?.textContent?.trim()).toBe('alice@example.com');
  });

  it('SMS phone input is hidden by default', () => {
    const phoneInput = fixture.nativeElement.querySelector('.phone-input');
    expect(phoneInput).toBeNull();
  });

  it('SMS phone input appears when SMS toggle is checked', () => {
    const smsCheckbox: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[aria-label="SMS notifications"]'
    );
    smsCheckbox.checked = true;
    smsCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const phoneInput = fixture.nativeElement.querySelector('.phone-input');
    expect(phoneInput).not.toBeNull();
  });

  it('SMS phone input disappears when SMS toggle unchecked', () => {
    // Turn on
    const smsCheckbox: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[aria-label="SMS notifications"]'
    );
    smsCheckbox.checked = true;
    smsCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.phone-input')).not.toBeNull();

    // Turn off
    smsCheckbox.checked = false;
    smsCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.phone-input')).toBeNull();
  });

  it('onSave calls updateUser and patchPreferences', () => {
    fixture.componentInstance.onSave();
    expect(userMock.updateUser).toHaveBeenCalled();
    expect(prefsMock.patchPreferences).toHaveBeenCalled();
  });

  it('onSave marks account complete and navigates on success', () => {
    vi.spyOn(router, 'navigate');
    fixture.componentInstance.onSave();
    expect(stateMock.markComplete).toHaveBeenCalledWith('account');
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  it('onSave sets saveError on failure', () => {
    prefsMock.patchPreferences.mockReturnValue(throwError(() => new Error('fail')));
    fixture.componentInstance.onSave();
    expect(fixture.componentInstance.saveError()).toBe(true);
  });

  describe('device-zone seeding', () => {
    it('POSTs to /timezone/device with the device zone on successful save', () => {
      fixture.componentInstance.onSave();

      const req = httpMock.expectOne('http://localhost:3000/timezone/device');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone });

      req.flush({ outcome: 'no_change', effective_zone: null, confirm: null });
    });

    it('does not POST to /timezone/device a second time when onSave is called again', () => {
      // First save — should fire the device-zone POST once.
      fixture.componentInstance.onSave();
      httpMock.expectOne('http://localhost:3000/timezone/device')
        .flush({ outcome: 'no_change', effective_zone: null, confirm: null });

      // Second save — guard flag must prevent a second POST.
      fixture.componentInstance.onSave();
      const second = httpMock.match('http://localhost:3000/timezone/device');
      expect(second.length).toBe(0);
    });

    it('does not POST to /timezone/device when save fails', () => {
      prefsMock.patchPreferences.mockReturnValue(throwError(() => new Error('fail')));
      fixture.componentInstance.onSave();
      const requests = httpMock.match('http://localhost:3000/timezone/device');
      expect(requests.length).toBe(0);
    });
  });
});
