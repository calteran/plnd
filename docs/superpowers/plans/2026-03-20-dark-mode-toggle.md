# Dark Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 2-state toggle (device preference ↔ override) to the navbar avatar dropdown, backed by a `plnd_theme_override` boolean in `localStorage`, and remove `theme` from the backend preferences entirely.

**Architecture:** A new `ThemeService` captures the device OS preference once at init and exposes `effectiveTheme: Signal<'light' | 'dark'>` and `toggle()`. `AppComponent` reads this signal to apply `data-theme` on `<html>`. The dropdown toggle button calls `themeService.toggle()`; the Settings page loses its theme section entirely. The `theme` column is dropped from `user_preferences` and all related Rust code removed.

**Tech Stack:** Angular 21 (signals, `computed()`, `effect()`, standalone components), `localStorage`, Rust/Axum, SQLx migrations.

---

## File Map

**Created:**
- `plnd_api/migrations/0014_remove_theme_from_preferences.sql`
- `plnd_client/src/app/core/services/theme.service.ts`
- `plnd_client/src/app/core/services/theme.service.spec.ts`

**Modified:**
- `plnd_api/src/db/models/mod.rs` — remove `theme` field from `UserPreferences`
- `plnd_api/src/db/preferences.rs` — remove `upsert()`, simplify `get_or_create()` RETURNING clause
- `plnd_api/src/routes/preferences.rs` — remove `PATCH` handler, `VALID_THEMES`, `UpdatePreferencesRequest`
- `plnd_api/src/main.rs` — remove `.route("/preferences/me", patch(...))` and unused `patch` import
- `plnd_client/src/app/app.ts` — swap `PreferencesService` → `ThemeService`; simplify effect
- `plnd_client/src/app/app.spec.ts` — remove HTTP provider; use real `ThemeService`
- `plnd_client/src/app/features/settings/settings.ts` — full rewrite (remove theme section; minimal placeholder)
- `plnd_client/src/app/features/settings/settings.spec.ts` — full rewrite (no HTTP mocks, no ThemeService)
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts` — add toggle row, fix design tokens
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts` — update ThemeService mock, fix Sign out index, add 3 tests
- `plnd_client/src/app/core/models/preferences.ts` — remove `Theme` export, remove `theme` from interfaces, remove `UpdatePreferencesRequest`
- `plnd_client/src/app/core/services/preferences.service.ts` — remove `updatePreferences()`
- `plnd_client/src/app/core/services/preferences.service.spec.ts` — remove `updatePreferences` test, update `mockPrefs`

**Deleted:**
- `plnd_api/tests/preferences_test.rs`

> **Note:** `auth.service.ts` is intentionally not modified. Its `logout()` method calls `preferencesService.clearPreferences()`, which remains valid after Task 6 slims the service.

---

## Task 1: Backend — drop theme column and clean up Rust

**Files:**
- Create: `plnd_api/migrations/0014_remove_theme_from_preferences.sql`
- Modify: `plnd_api/src/db/models/mod.rs`
- Modify: `plnd_api/src/db/preferences.rs`
- Modify: `plnd_api/src/routes/preferences.rs`
- Modify: `plnd_api/src/main.rs`
- Delete: `plnd_api/tests/preferences_test.rs`

- [ ] **Step 1: Create the migration**

```sql
-- plnd_api/migrations/0014_remove_theme_from_preferences.sql
ALTER TABLE user_preferences DROP COLUMN theme;
```

- [ ] **Step 2: Remove `theme` from the `UserPreferences` model**

In `plnd_api/src/db/models/mod.rs`, find the `UserPreferences` struct and remove the `theme` field:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct UserPreferences {
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 3: Simplify `db/preferences.rs`**

Replace the entire file content:

```rust
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;
use crate::db::models::UserPreferences;

/// Get preferences for a user, creating a default row if none exists.
pub async fn get_or_create(pool: &PgPool, user_id: Uuid) -> Result<UserPreferences, DatabaseError> {
    sqlx::query_as::<_, UserPreferences>(
        "INSERT INTO user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = user_preferences.updated_at
         RETURNING user_id, created_at, updated_at",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DatabaseError::QueryError(e.to_string()))
}
```

The `upsert()` function is removed — nothing calls it after PATCH is gone.

- [ ] **Step 4: Simplify `routes/preferences.rs`**

Replace the entire file content (remove `PATCH` handler, `VALID_THEMES`, `UpdatePreferencesRequest`):

```rust
use crate::auth::jwt::Claims;
use crate::db;
use crate::db::models::UserPreferences;
use crate::state::AppState;
use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

#[utoipa::path(
    get,
    path = "/preferences/me",
    tag = "Preferences",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "User preferences", body = UserPreferences),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
/// GET /preferences/me — return the current user's preferences, creating defaults if absent
pub async fn get_preferences(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPreferences>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::preferences::get_or_create(pool, user_id)
        .await
        .map(Json)
        .map_err(|e| {
            eprintln!("get_preferences DB error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 5: Remove the PATCH route from `main.rs`**

Find and remove this line:

```rust
.route("/preferences/me", patch(preferences::patch_preferences))
```

Also remove `patch` from the axum routing imports if it is only used for that route. Search for `use axum::routing::{...}` and verify `patch` is no longer needed.

- [ ] **Step 6: Delete `plnd_api/tests/preferences_test.rs`**

Both tests reference `req.theme` which no longer exists. Stage the deletion with git:

```bash
git rm plnd_api/tests/preferences_test.rs
```

- [ ] **Step 7: Verify Rust compiles**

```bash
just verify-build
```
Expected: clean compile, no errors.

- [ ] **Step 8: Commit**

```bash
git add plnd_api/migrations/0014_remove_theme_from_preferences.sql \
        plnd_api/src/db/models/mod.rs \
        plnd_api/src/db/preferences.rs \
        plnd_api/src/routes/preferences.rs \
        plnd_api/src/main.rs
git rm plnd_api/tests/preferences_test.rs
git commit -m "feat(api): remove theme from user_preferences — localStorage-based in frontend"
```

---

## Task 2: Angular — `ThemeService` (TDD)

**Files:**
- Create: `plnd_client/src/app/core/services/theme.service.spec.ts`
- Create: `plnd_client/src/app/core/services/theme.service.ts`

The service captures `devicePrefersDark` once at construction (plain boolean, not a signal). `effectiveTheme` is a computed signal that depends only on `isOverriddenSignal`. `toggle()` flips the override and writes/removes the localStorage key.

- [ ] **Step 1: Write the failing tests**

Create `plnd_client/src/app/core/services/theme.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const OVERRIDE_KEY = 'plnd_theme_override';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('isOverridden defaults to false when key is absent', () => {
    expect(service.isOverridden()).toBeFalse();
  });

  it('isOverridden reads true from localStorage on init', () => {
    localStorage.setItem(OVERRIDE_KEY, '1');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.isOverridden()).toBeTrue();
  });

  it('toggle() sets isOverridden to true and writes localStorage', () => {
    service.toggle();
    expect(service.isOverridden()).toBeTrue();
    expect(localStorage.getItem(OVERRIDE_KEY)).toBe('1');
  });

  it('toggle() a second time sets isOverridden to false and removes key', () => {
    service.toggle();
    service.toggle();
    expect(service.isOverridden()).toBeFalse();
    expect(localStorage.getItem(OVERRIDE_KEY)).toBeNull();
  });

  it('effectiveTheme() returns "light" when device is light and not overridden', () => {
    // matchMedia returns { matches: false } (light device) from beforeEach
    expect(service.effectiveTheme()).toBe('light');
  });

  it('effectiveTheme() returns "dark" when device is light and overridden', () => {
    // device = light, override = opposite = dark
    service.toggle();
    expect(service.effectiveTheme()).toBe('dark');
  });

  it('effectiveTheme() returns "dark" when device is dark and not overridden', () => {
    (window.matchMedia as jasmine.Spy).and.returnValue({ matches: true } as MediaQueryList);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.effectiveTheme()).toBe('dark');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```
Expected: `ThemeService` tests fail with "Cannot find module './theme.service'".

- [ ] **Step 3: Implement `ThemeService`**

Create `plnd_client/src/app/core/services/theme.service.ts`:

```typescript
import { Injectable, Signal, computed, signal } from '@angular/core';

export type EffectiveTheme = 'light' | 'dark';

const OVERRIDE_KEY = 'plnd_theme_override';

function readIsOverridden(): boolean {
  return localStorage.getItem(OVERRIDE_KEY) === '1';
}

function devicePrefersDark(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly deviceDark = devicePrefersDark();
  private readonly isOverriddenSignal = signal<boolean>(readIsOverridden());

  readonly isOverridden: Signal<boolean> = this.isOverriddenSignal.asReadonly();

  readonly effectiveTheme: Signal<EffectiveTheme> = computed(() => {
    const useDark = this.isOverriddenSignal() ? !this.deviceDark : this.deviceDark;
    return useDark ? 'dark' : 'light';
  });

  toggle(): void {
    const newOverridden = !this.isOverriddenSignal();
    if (newOverridden) {
      localStorage.setItem(OVERRIDE_KEY, '1');
    } else {
      localStorage.removeItem(OVERRIDE_KEY);
    }
    this.isOverriddenSignal.set(newOverridden);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
just test-ng-headless
```
Expected: all `ThemeService` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/core/services/theme.service.ts \
        plnd_client/src/app/core/services/theme.service.spec.ts
git commit -m "feat(client): ThemeService — localStorage override toggle, device-aware"
```

---

## Task 3: Angular — `AppComponent` refactor

**Files:**
- Modify: `plnd_client/src/app/app.ts`
- Modify: `plnd_client/src/app/app.spec.ts`

`AppComponent` no longer needs matchMedia logic — `effectiveTheme` is always `'light'` or `'dark'`. Use the real `ThemeService` in tests (no HTTP deps, no mocking needed).

- [ ] **Step 1: Update `app.spec.ts`**

Replace the full file:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { RouterTestingModule } from '@angular/router/testing';
import { ThemeService } from './core/services/theme.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(() => {
    localStorage.clear();
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('applies data-theme="light" when effectiveTheme is "light"', () => {
    // device = light (matchMedia.matches = false), no override
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies data-theme="dark" after toggle (device light → override → dark)', () => {
    const themeService = TestBed.inject(ThemeService);
    themeService.toggle();
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```
Expected: `AppComponent` tests fail — `app.ts` still imports `PreferencesService`.

- [ ] **Step 3: Update `app.ts`**

Replace the full file:

```typescript
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`
})
export class AppComponent {
  private readonly themeService = inject(ThemeService);

  constructor() {
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.themeService.effectiveTheme());
    });
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
just test-ng-headless
```
Expected: all `AppComponent` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/app.ts \
        plnd_client/src/app/app.spec.ts
git commit -m "refactor(client): AppComponent uses ThemeService.effectiveTheme()"
```

---

## Task 4: Angular — `SettingsComponent` refactor

**Files:**
- Modify: `plnd_client/src/app/features/settings/settings.ts`
- Modify: `plnd_client/src/app/features/settings/settings.spec.ts`

Theme section is removed entirely from Settings. The component becomes a minimal placeholder with back navigation. No `ThemeService` or `PreferencesService` dependency.

- [ ] **Step 1: Rewrite `settings.spec.ts`**

Replace the full file:

```typescript
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { SettingsComponent } from './settings';

describe('SettingsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent, RouterTestingModule]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders immediately with no loading guard', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Settings');
    expect(fixture.nativeElement.querySelector('.loading-text')).toBeNull();
  });

  it('goBack() navigates to /dashboard', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    fixture.componentInstance.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```
Expected: `SettingsComponent` tests fail — component still uses old `PreferencesService` API.

- [ ] **Step 3: Rewrite `settings.ts`**

Replace the full file:

```typescript
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>Settings</h1>
      </div>
      <p class="placeholder">More settings coming soon.</p>
    </div>
  `,
  styles: [`
    .settings-page {
      max-width: 600px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    .settings-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--color-accent);
      padding: 0.25rem 0.5rem;
    }

    .back-btn:hover { text-decoration: underline; }

    h1 { margin: 0; font-size: 1.5rem; }

    .placeholder { color: var(--color-text-muted); font-size: 0.875rem; }
  `]
})
export class SettingsComponent {
  private readonly router = inject(Router);

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
just test-ng-headless
```
Expected: all `SettingsComponent` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/settings/settings.ts \
        plnd_client/src/app/features/settings/settings.spec.ts
git commit -m "refactor(client): SettingsComponent — remove theme section, placeholder page"
```

---

## Task 5: Angular — `NavbarAvatarComponent` toggle row + design tokens

**Files:**
- Modify: `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts`
- Modify: `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts`

The theme row shows the current effective theme (☀️ / 🌙) and calls `themeService.toggle()`. No "system" state is shown.

- [ ] **Step 1: Update `navbar-avatar.spec.ts`**

Replace the full file:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```
Expected: new theme tests fail (no `effectiveTheme` or `toggle` on service); Sign out test at old index fails.

- [ ] **Step 3: Update `navbar-avatar.ts`**

Replace the full file:

```typescript
import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
just test-ng-headless
```
Expected: all `NavbarAvatarComponent` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts \
        plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts
git commit -m "feat(client): add theme toggle to navbar avatar dropdown"
```

---

## Task 6: Angular — preferences model/service cleanup

**Files:**
- Modify: `plnd_client/src/app/core/models/preferences.ts`
- Modify: `plnd_client/src/app/core/services/preferences.service.ts`
- Modify: `plnd_client/src/app/core/services/preferences.service.spec.ts`

`Theme` no longer exists in the preferences model. `UpdatePreferencesRequest` is gone. `updatePreferences()` is removed from the service.

- [ ] **Step 1: Update `preferences.ts`**

Replace the full file:

```typescript
export interface UserPreferences {
  user_id: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Update `preferences.service.ts`**

Replace the full file:

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from './config.service';
import { UserPreferences } from '../models/preferences';

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private readonly preferencesSignal = signal<UserPreferences | null>(null);

  /** The current user preferences — null until loadPreferences() succeeds */
  readonly preferences = this.preferencesSignal.asReadonly();

  /** Fetch preferences from the API and cache in the signal. No-ops if already loaded. */
  loadPreferences(): void {
    if (this.preferencesSignal()) return;

    const apiBase = this.config.getConfig().api.baseUrl;
    this.http.get<UserPreferences>(`${apiBase}/preferences/me`).subscribe({
      next: prefs => this.preferencesSignal.set(prefs),
      error: err => console.error('Failed to load preferences', err)
    });
  }

  /** Reset the preferences signal (called on logout) */
  clearPreferences(): void {
    this.preferencesSignal.set(null);
  }
}
```

- [ ] **Step 3: Update `preferences.service.spec.ts`**

Replace the full file:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PreferencesService } from './preferences.service';
import { UserPreferences } from '../models/preferences';

const mockPrefs: UserPreferences = {
  user_id: 'test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

describe('PreferencesService', () => {
  let service: PreferencesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(PreferencesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('loadPreferences sets the signal', () => {
    expect(service.preferences()).toBeNull();
    service.loadPreferences();
    const req = httpMock.expectOne(r => r.url.endsWith('/preferences/me') && r.method === 'GET');
    req.flush(mockPrefs);
    expect(service.preferences()).toEqual(mockPrefs);
  });

  it('loadPreferences no-ops when already loaded', () => {
    service.loadPreferences();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    service.loadPreferences();
    httpMock.expectNone(r => r.url.endsWith('/preferences/me'));
    expect(service.preferences()).toEqual(mockPrefs);
  });

  it('clearPreferences resets to null', () => {
    service.loadPreferences();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    service.clearPreferences();
    expect(service.preferences()).toBeNull();
  });
});
```

- [ ] **Step 4: Run full test suite**

```bash
just test-ci
```
Expected: all Rust and Angular tests pass.

- [ ] **Step 5: Run full quality check**

```bash
just verify
```
Expected: fmt, clippy, deny, machete, ts-lint, ts-deps, build, tests — all clean.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/core/models/preferences.ts \
        plnd_client/src/app/core/services/preferences.service.ts \
        plnd_client/src/app/core/services/preferences.service.spec.ts
git commit -m "chore(client): remove theme from preferences model and service"
```

---

## Verification

1. `just verify` passes cleanly
2. Manual smoke test:
   - Open the app and click the avatar — see the Theme row with ☀️ / "light" (or 🌙 / "dark" if OS prefers dark)
   - Click Theme row → icon flips (☀️↔🌙), `data-theme` attribute on `<html>` toggles instantly, dropdown stays open
   - Click again → back to following device preference
   - Refresh the page — override state persists from `localStorage`
   - Navigate to Settings — no theme control visible
   - Sign out and back in — theme override is not reset (it's device-local)
