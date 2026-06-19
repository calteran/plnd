import { Component, HostListener, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService, EffectiveTheme } from '../../../core/services/theme.service';

const THEME_ICONS: Record<EffectiveTheme, string> = {
  light: '☀️',
  dark: '🌙'
};

@Component({
  selector: 'app-navbar-avatar',
  standalone: true,
  template: `
    <div class="avatar-container">
      <button
        class="avatar-btn"
        (click)="toggleDropdown($event)"
        [attr.aria-label]="'User menu for ' + (userService.user()?.email ?? 'user')"
        aria-haspopup="true"
        [attr.aria-expanded]="dropdownOpen()"
      >
        @if (userService.user()?.avatar_url) {
          <img
            class="avatar-img"
            [src]="userService.user()!.avatar_url!"
            [alt]="userService.user()!.display_name ?? userService.user()!.email"
          />
        } @else {
          <span class="avatar-initials">{{ initials() }}</span>
        }
      </button>

      @if (dropdownOpen()) {
        <div class="dropdown-panel" role="menu">
          <button class="dropdown-item" role="menuitem" (click)="goToProfile()">
            My Profile
          </button>
          <button class="dropdown-item" role="menuitem" (click)="goToSettings()">
            Settings
          </button>
          <button class="dropdown-item dropdown-item--theme" role="menuitem" (click)="toggleTheme($event)">
            <span class="theme-label">Theme</span>
            <span class="theme-right">
              <span class="theme-name">{{ themeService.effectiveTheme() }}</span>
              <span class="theme-icon">{{ themeIcon() }}</span>
            </span>
          </button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item dropdown-item--danger" role="menuitem" (click)="signOut()">
            Sign out
          </button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .avatar-container {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .avatar-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      padding: 0;
      overflow: hidden;
      background: var(--color-accent);
      color: var(--color-surface-white);
      font-size: 0.875rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s ease;
    }

    .avatar-btn:hover { opacity: 0.85; }

    .avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .avatar-initials {
      pointer-events: none;
      text-transform: uppercase;
    }

    .dropdown-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 180px;
      background: var(--color-surface-white);
      border: 1px solid var(--color-border-row);
      border-radius: 6px;
      box-shadow: var(--shadow-dropdown);
      z-index: 100;
      overflow: hidden;
    }

    .dropdown-item {
      display: block;
      width: 100%;
      padding: 0.625rem 1rem;
      text-align: left;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--color-text-body);
      transition: background 0.1s ease;
    }

    .dropdown-item:hover { background: var(--color-border-row); }

    .dropdown-item--theme {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .theme-label {
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }

    .theme-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .theme-name {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      text-transform: lowercase;
    }

    .theme-icon {
      width: 26px;
      height: 26px;
      background: var(--color-surface-base);
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
    }

    .dropdown-item--danger { color: var(--color-destructive); }

    .dropdown-item--danger:hover {
      background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    }

    .dropdown-divider {
      height: 1px;
      background: var(--color-border-row);
      margin: 0;
    }
  `]
})
export class NavbarAvatarComponent implements OnInit {
  readonly userService = inject(UserService);
  readonly themeService = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly dropdownOpen = signal(false);
  readonly themeIcon = computed(() => THEME_ICONS[this.themeService.effectiveTheme()]);

  ngOnInit(): void {
    this.userService.loadUser();
  }

  initials(): string {
    const user = this.userService.user();
    if (!user) return '?';
    const source = user.display_name ?? user.email;
    return source.charAt(0).toUpperCase();
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.dropdownOpen.update(v => !v);
  }

  @HostListener('document:click')
  closeDropdown(): void {
    this.dropdownOpen.set(false);
  }

  toggleTheme(event: Event): void {
    event.stopPropagation(); // keep dropdown open
    this.themeService.toggle();
  }

  goToProfile(): void {
    this.dropdownOpen.set(false);
    this.router.navigate(['/profile']);
  }

  goToSettings(): void {
    this.dropdownOpen.set(false);
    this.router.navigate(['/settings']);
  }

  signOut(): void {
    this.dropdownOpen.set(false);
    this.auth.logout();
  }
}
