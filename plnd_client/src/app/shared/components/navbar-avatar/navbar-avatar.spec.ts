import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NavbarAvatarComponent } from './navbar-avatar';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { signal } from '@angular/core';
import { User } from '../../../core/models/user';

const mockUser: User = {
  user_id: 'test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null
};

describe('NavbarAvatarComponent', () => {
  let fixture: ComponentFixture<NavbarAvatarComponent>;
  let component: NavbarAvatarComponent;
  let mockUserSignal: ReturnType<typeof signal<User | null>>;
  let router: Router;

  beforeEach(async () => {
    mockUserSignal = signal<User | null>(null);

    const userServiceMock = {
      user: mockUserSignal.asReadonly(),
      loadUser: jasmine.createSpy('loadUser')
    };

    const authServiceMock = {
      logout: jasmine.createSpy('logout')
    };

    await TestBed.configureTestingModule({
      imports: [NavbarAvatarComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        { provide: UserService, useValue: userServiceMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(NavbarAvatarComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('calls loadUser on init', () => {
    const userService = TestBed.inject(UserService);
    expect(userService.loadUser).toHaveBeenCalled();
  });

  it('renders initials when no avatar_url', () => {
    mockUserSignal.set(mockUser);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const initials = el.querySelector('.avatar-initials');
    expect(initials?.textContent?.trim()).toBe('T');
  });

  it('renders img when avatar_url is set', () => {
    mockUserSignal.set({ ...mockUser, avatar_url: 'https://example.com/avatar.jpg' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const img = el.querySelector('img.avatar-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('avatar.jpg');
  });

  it('toggles dropdown on avatar button click', () => {
    expect(component.dropdownOpen()).toBeFalse();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.avatar-btn');
    btn.click();
    fixture.detectChanges();

    expect(component.dropdownOpen()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.dropdown-panel')).toBeTruthy();
  });

  it('navigates to /profile when "My Profile" is clicked', () => {
    spyOn(router, 'navigate');
    component.dropdownOpen.set(true);
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.dropdown-item') as NodeListOf<HTMLButtonElement>;
    items[0].click();

    expect(router.navigate).toHaveBeenCalledWith(['/profile']);
  });

  it('calls auth.logout() when "Sign out" is clicked', () => {
    component.dropdownOpen.set(true);
    fixture.detectChanges();

    const authService = TestBed.inject(AuthService);
    const items = fixture.nativeElement.querySelectorAll('.dropdown-item') as NodeListOf<HTMLButtonElement>;
    items[2].click();

    expect(authService.logout).toHaveBeenCalled();
  });
});
