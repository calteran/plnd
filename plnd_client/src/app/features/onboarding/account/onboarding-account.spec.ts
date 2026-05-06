import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    loadUser: jasmine.createSpy('loadUser'),
    updateUser: jasmine.createSpy('updateUser').and.returnValue(of({})),
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
    loadPreferences: jasmine.createSpy('loadPreferences'),
    patchPreferences: jasmine.createSpy('patchPreferences').and.returnValue(of({})),
  };
}

function makeStateMock() {
  return {
    markComplete: jasmine.createSpy('markComplete'),
  };
}

describe('OnboardingAccountComponent', () => {
  let fixture: ComponentFixture<OnboardingAccountComponent>;
  let userMock: ReturnType<typeof makeUserServiceMock>;
  let prefsMock: ReturnType<typeof makePrefsServiceMock>;
  let stateMock: ReturnType<typeof makeStateMock>;
  let router: Router;

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
    fixture = TestBed.createComponent(OnboardingAccountComponent);
    fixture.detectChanges();
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
    spyOn(router, 'navigate');
    fixture.componentInstance.onSave();
    expect(stateMock.markComplete).toHaveBeenCalledWith('account');
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
  });

  it('onSave sets saveError on failure', () => {
    prefsMock.patchPreferences.and.returnValue(throwError(() => new Error('fail')));
    fixture.componentInstance.onSave();
    expect(fixture.componentInstance.saveError()).toBeTrue();
  });
});
