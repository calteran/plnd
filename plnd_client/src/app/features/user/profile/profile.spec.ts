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

  it('goBack navigates to /dashboard', () => {
    spyOn(router, 'navigate');
    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
