import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NavbarAvatarComponent } from './navbar-avatar';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService, EffectiveTheme } from '../../../core/services/theme.service';
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
  last_login: null,
  onboarding_completed: true
};

describe('NavbarAvatarComponent', () => {
  let fixture: ComponentFixture<NavbarAvatarComponent>;
  let component: NavbarAvatarComponent;
  let mockUserSignal: ReturnType<typeof signal<User | null>>;
  let mockEffectiveThemeSignal: ReturnType<typeof signal<EffectiveTheme>>;
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;
  let router: Router;

  beforeEach(async () => {
    mockUserSignal = signal<User | null>(null);
    mockEffectiveThemeSignal = signal<EffectiveTheme>('light');

    const userServiceMock = {
      user: mockUserSignal.asReadonly(),
      loadUser: jasmine.createSpy('loadUser')
    };

    const authServiceMock = {
      logout: jasmine.createSpy('logout')
    };

    themeServiceSpy = jasmine.createSpyObj('ThemeService', ['toggle'], {
      effectiveTheme: mockEffectiveThemeSignal.asReadonly()
    });

    await TestBed.configureTestingModule({
      imports: [NavbarAvatarComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        { provide: UserService, useValue: userServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: ThemeService, useValue: themeServiceSpy }
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
    // Sign out is now index 3 (My Profile=0, Settings=1, Theme=2, Sign out=3)
    items[3].click();
    expect(authService.logout).toHaveBeenCalled();
  });

  it('initials() returns "?" when user signal is null', () => {
    expect(component.initials()).toBe('?');
  });

  it('goToSettings() navigates to /settings', () => {
    spyOn(router, 'navigate');
    component.goToSettings();
    expect(router.navigate).toHaveBeenCalledWith(['/settings']);
  });

  it('@HostListener closes dropdown on document click', () => {
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    document.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(component.dropdownOpen()).toBeFalse();
  });

  it('initials() uses email initial when display_name is null', () => {
    mockUserSignal.set({ ...mockUser, display_name: null });
    fixture.detectChanges();
    expect(component.initials()).toBe('T');
  });

  // --- Theme toggle row tests ---

  it('renders ☀️ when effectiveTheme is "light"', () => {
    mockEffectiveThemeSignal.set('light');
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.theme-icon') as HTMLElement;
    expect(icon?.textContent?.trim()).toBe('☀️');
  });

  it('renders 🌙 when effectiveTheme is "dark"', () => {
    mockEffectiveThemeSignal.set('dark');
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.theme-icon') as HTMLElement;
    expect(icon?.textContent?.trim()).toBe('🌙');
  });

  it('clicking the theme row calls themeService.toggle() and keeps dropdown open', () => {
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.dropdown-item') as NodeListOf<HTMLButtonElement>;
    items[2].click(); // Theme row is index 2
    fixture.detectChanges();
    expect(themeServiceSpy.toggle).toHaveBeenCalled();
    expect(component.dropdownOpen()).toBeTrue();
  });
});
