import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';

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
          <div class="dropdown-divider"></div>
          <button class="dropdown-item dropdown-item--danger" role="menuitem" (click)="signOut()">
            Sign out
          </button>
        </div>
      }
    </div>
  `,
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
      background: #6366f1;
      color: #fff;
      font-size: 0.875rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s ease;
    }

    .avatar-btn:hover {
      opacity: 0.85;
    }

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
      min-width: 160px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
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
      color: #374151;
      transition: background 0.1s ease;
    }

    .dropdown-item:hover {
      background: #f3f4f6;
    }

    .dropdown-item--danger {
      color: #dc2626;
    }

    .dropdown-item--danger:hover {
      background: #fef2f2;
    }

    .dropdown-divider {
      height: 1px;
      background: #e0e0e0;
      margin: 0;
    }
  `]
})
export class NavbarAvatarComponent implements OnInit {
  readonly userService = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly dropdownOpen = signal(false);

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

  goToProfile(): void {
    this.dropdownOpen.set(false);
    this.router.navigate(['/profile']);
  }

  signOut(): void {
    this.dropdownOpen.set(false);
    this.auth.logout();
  }
}
