import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { ProfileComponent } from './profile';
import { UserService } from '../../../core/services/user.service';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { User } from '../../../core/models/user';

const mockUser: User = {
  user_id: 'test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: '2026-03-01T12:00:00Z',
  onboarding_completed: true
};

describe('ProfileComponent', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let component: ProfileComponent;
  let mockUserSignal: ReturnType<typeof signal<User | null>>;
  let userService: jasmine.SpyObj<UserService>;
  let router: Router;

  beforeEach(async () => {
    mockUserSignal = signal<User | null>(mockUser);

    userService = jasmine.createSpyObj('UserService', ['loadUser', 'updateUser'], {
      user: mockUserSignal.asReadonly()
    });
    userService.updateUser.and.returnValue(of(mockUser));

    await TestBed.configureTestingModule({
      imports: [ProfileComponent, RouterTestingModule],
      providers: [{ provide: UserService, useValue: userService }]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('renders user email and read-only fields', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('test@example.com');
  });

  it('populates the form with the current user values', () => {
    expect(component.form.value.display_name).toBe('Test User');
  });

  it('save calls updateUser and shows success message', () => {
    component.form.setValue({ display_name: 'New Name', avatar_url: '' });
    component.save();

    expect(userService.updateUser).toHaveBeenCalled();
    expect(component.successMessage).toBe('Profile updated.');
    expect(component.pending).toBeFalse();
  });

  it('save shows error message on failure', () => {
    userService.updateUser.and.returnValue(throwError(() => new Error('500')));
    component.form.setValue({ display_name: 'New Name', avatar_url: '' });
    component.save();

    expect(component.errorMessage).toBe('Failed to save. Please try again.');
    expect(component.pending).toBeFalse();
  });

  it('cancel resets the form to current user values', () => {
    component.form.setValue({ display_name: 'Changed', avatar_url: 'https://x.com/img.jpg' });
    component.cancel();

    expect(component.form.value.display_name).toBe('Test User');
    expect(component.form.value.avatar_url).toBe('');
  });

  it('goBack navigates to /today', () => {
    spyOn(router, 'navigate');
    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/today']);
  });

  describe('when user has no last_login', () => {
    beforeEach(async () => {
      mockUserSignal.set({ ...mockUser, last_login: null });
      fixture.detectChanges();
    });

    it('shows "Never" for last login', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Never');
    });
  });

  it('save() no-ops when pending is true', () => {
    component.pending = true;
    component.form.setValue({ display_name: 'New Name', avatar_url: '' });
    component.save();
    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('save() excludes null form values from the update request', () => {
    component.form.controls.display_name.setValue(null as unknown as string);
    component.form.controls.avatar_url.setValue(null as unknown as string);
    component.save();
    expect(userService.updateUser).toHaveBeenCalledWith({});
  });

  it('shows display_name field error when field is touched and too long', () => {
    component.form.controls.display_name.setValue('x'.repeat(101));
    component.form.controls.display_name.markAsTouched();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.field-error')?.textContent).toContain('100 characters');
  });

  it('shows avatar_url field error when field is touched and too long', () => {
    component.form.controls.avatar_url.setValue('x'.repeat(501));
    component.form.controls.avatar_url.markAsTouched();
    fixture.detectChanges();
    const el2 = fixture.nativeElement as HTMLElement;
    const errors = el2.querySelectorAll<Element>('.field-error');
    const texts = Array.from(errors).map(e => e.textContent ?? '');
    expect(texts.some(t => t.includes('500 characters'))).toBeTrue();
  });
});
