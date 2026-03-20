# Dark Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cycle toggle (system → light → dark → system) to the navbar avatar dropdown, backed by `localStorage` instead of the database, and remove `theme` from the backend preferences entirely.

**Architecture:** A new `ThemeService` owns localStorage-backed theme state as an Angular signal. `AppComponent` reads this signal to apply `data-theme` on `<html>`. The dropdown cycle button calls `themeService.cycleTheme()`; the Settings page binds to `ThemeService` directly with no API call. The `theme` column is dropped from `user_preferences` and all related Rust code removed.

**Tech Stack:** Angular 21 (signals, `effect()`, standalone components), `localStorage`, Rust/Axum, SQLx migrations.

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
- `plnd_api/src/main.rs` — remove `.route("/preferences/me", patch(...))`
- `plnd_api/tests/preferences_test.rs` — remove theme assertions; delete both tests (file becomes empty — delete it)
- `plnd_client/src/app/app.ts` — swap `PreferencesService` → `ThemeService`
- `plnd_client/src/app/app.spec.ts` — remove HTTP provider; spy on `ThemeService`
- `plnd_client/src/app/features/settings/settings.ts` — full rewrite (immediate-apply, no Save button)
- `plnd_client/src/app/features/settings/settings.spec.ts` — full rewrite (no HTTP mocks)
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts` — add cycle row, fix design tokens
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts` — add 3 tests, fix Sign out index
- `plnd_client/src/app/core/models/preferences.ts` — remove `Theme` export, remove `theme` from interfaces, remove `UpdatePreferencesRequest`
- `plnd_client/src/app/core/services/preferences.service.ts` — remove `updatePreferences()`
- `plnd_client/src/app/core/services/preferences.service.spec.ts` — remove `updatePreferences` test, update `mockPrefs`

> **Note:** `auth.service.ts` is intentionally not modified. Its `logout()` method calls `preferencesService.clearPreferences()`, which remains valid after Task 6 slims the service — the method is retained.

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

In `plnd_api/src/db/models/mod.rs`, find the `UserPreferences` struct (around line 14) and remove the `theme` field:

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

Find and remove this line (around line 172):

```rust
.route("/preferences/me", patch(preferences::patch_preferences))
```

Also remove `patch` from the axum method imports if it is only used for that route. Search for `use axum::routing::{...}` and verify `patch` is no longer needed.

- [ ] **Step 6: Delete `plnd_api/tests/preferences_test.rs`**

Both tests reference `req.theme` which no longer exists on `UpdatePreferencesRequest` (which is itself deleted). Stage the deletion directly with git:

```bash
git rm plnd_api/tests/preferences_test.rs
```

- [ ] **Step 7: Verify Rust compiles**

Run from project root:
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

- [ ] **Step 1: Write the failing tests**

Create `plnd_client/src/app/core/services/theme.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { Theme } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('defaults to "system" when localStorage is empty', () => {
    expect(service.theme()).toBe('system');
  });

  it('reads persisted value from localStorage on init', () => {
    localStorage.setItem('plnd_theme', 'dark');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const freshService = TestBed.inject(ThemeService);
    expect(freshService.theme()).toBe('dark');
  });

  it('cycleTheme() advances system → light → dark → system', () => {
    expect(service.theme()).toBe('system');
    service.cycleTheme();
    expect(service.theme()).toBe('light');
    service.cycleTheme();
    expect(service.theme()).toBe('dark');
    service.cycleTheme();
    expect(service.theme()).toBe('system');
  });

  it('setTheme() updates signal and writes to localStorage', () => {
    service.setTheme('dark');
    expect(service.theme()).toBe('dark');
    expect(localStorage.getItem('plnd_theme')).toBe('dark');
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
import { Injectable, signal } from '@angular/core';

export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'plnd_theme';
const THEME_CYCLE: Theme[] = ['system', 'light', 'dark'];

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return (THEME_CYCLE.includes(stored as Theme) ? stored : 'system') as Theme;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSignal = signal<Theme>(readStoredTheme());
  readonly theme = this.themeSignal.asReadonly();

  setTheme(theme: Theme): void {
    localStorage.setItem(THEME_KEY, theme);
    this.themeSignal.set(theme);
  }

  cycleTheme(): void {
    const idx = THEME_CYCLE.indexOf(this.themeSignal());
    this.setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
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
git commit -m "feat(client): ThemeService — localStorage-backed theme signal"
```

---

## Task 3: Angular — `AppComponent` refactor

**Files:**
- Modify: `plnd_client/src/app/app.ts`
- Modify: `plnd_client/src/app/app.spec.ts`

- [ ] **Step 1: Update `app.spec.ts`**

`AppComponent` will no longer inject `PreferencesService` (which needed `HttpClient`). Replace the full file:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { RouterTestingModule } from '@angular/router/testing';
import { ThemeService } from './core/services/theme.service';
import { signal } from '@angular/core';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(() => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
    localStorage.clear();
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

  it('applies data-theme="light" when theme is "light"', () => {
    const themeService = TestBed.inject(ThemeService);
    themeService.setTheme('light');
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies data-theme="dark" when theme is "dark"', () => {
    const themeService = TestBed.inject(ThemeService);
    themeService.setTheme('dark');
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies data-theme="dark" when theme is "system" and matchMedia prefers dark', () => {
    (window.matchMedia as jasmine.Spy).and.returnValue({ matches: true } as MediaQueryList);
    const themeService = TestBed.inject(ThemeService);
    themeService.setTheme('system');
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
      const theme = this.themeService.theme();
      const prefersDark = typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
      const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
      document.documentElement.setAttribute('data-theme', useDark ? 'dark' : 'light');
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
git commit -m "refactor(client): AppComponent uses ThemeService instead of PreferencesService"
```

---

## Task 4: Angular — `SettingsComponent` refactor

**Files:**
- Modify: `plnd_client/src/app/features/settings/settings.ts`
- Modify: `plnd_client/src/app/features/settings/settings.spec.ts`

The Settings page theme select becomes immediate-apply (no Save button). `PreferencesService` is removed entirely from this component.

- [ ] **Step 1: Rewrite `settings.spec.ts`**

Replace the full file (9 tests gone, replaced with 5 new ones):

```typescript
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { SettingsComponent } from './settings';
import { ThemeService } from '../../core/services/theme.service';

describe('SettingsComponent', () => {
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;

  beforeEach(async () => {
    themeServiceSpy = jasmine.createSpyObj('ThemeService', ['setTheme'], {
      theme: jasmine.createSpy('theme').and.returnValue('system')
    });

    await TestBed.configureTestingModule({
      imports: [SettingsComponent, RouterTestingModule],
      providers: [{ provide: ThemeService, useValue: themeServiceSpy }]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the theme select immediately (no loading state)', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select#theme')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.loading-text')).toBeNull();
  });

  it('theme select has correct options', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll('select#theme option') as NodeListOf<HTMLOptionElement>;
    const values = Array.from(options).map(o => o.value);
    expect(values).toEqual(['system', 'light', 'dark']);
  });

  it('changing theme select calls themeService.setTheme()', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select#theme') as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));
    expect(themeServiceSpy.setTheme).toHaveBeenCalledWith('dark');
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
import { ThemeService, Theme } from '../../core/services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <button class="back-btn" (click)="goBack()">← Back</button>
        <h1>Settings</h1>
      </div>

      <form class="settings-form">
        <div class="form-field">
          <label for="theme">Theme</label>
          <select id="theme" [value]="themeService.theme()" (change)="onThemeChange($event)">
            <option value="system">System default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </form>
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

    .settings-form { display: flex; flex-direction: column; gap: 1.25rem; }

    .form-field { display: flex; flex-direction: column; gap: 0.375rem; }

    label { font-size: 0.875rem; font-weight: 500; color: var(--color-text-body); }

    select {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border-row);
      border-radius: 6px;
      font-size: 0.875rem;
      background: var(--color-surface-white);
      color: var(--color-text-body);
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }

    select:focus { border-color: var(--color-accent); }
  `]
})
export class SettingsComponent {
  readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);

  onThemeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Theme;
    this.themeService.setTheme(value);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
```

Note: `OnInit` and `ReactiveFormsModule` imports are removed. The component no longer has pending state, error messages, or a Save button.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
just test-ng-headless
```
Expected: all `SettingsComponent` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/settings/settings.ts \
        plnd_client/src/app/features/settings/settings.spec.ts
git commit -m "refactor(client): SettingsComponent — immediate-apply theme via ThemeService"
```

---

## Task 5: Angular — `NavbarAvatarComponent` cycle row + design tokens

**Files:**
- Modify: `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts`
- Modify: `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts`

- [ ] **Step 1: Update `navbar-avatar.spec.ts`**

Three changes to the existing spec:
1. Add `ThemeService` mock to `providers`
2. Fix the Sign out test: `items[2]` → `items[3]` (Theme row is now at index 2)
3. Add three new tests for theme cycle behaviour

Replace the full file:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { NavbarAvatarComponent } from './navbar-avatar';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService, Theme } from '../../../core/services/theme.service';
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
  let mockThemeSignal: ReturnType<typeof signal<Theme>>;
  let themeServiceSpy: jasmine.SpyObj<ThemeService>;
  let router: Router;

  beforeEach(async () => {
    mockUserSignal = signal<User | null>(null);
    mockThemeSignal = signal<Theme>('system');

    const userServiceMock = {
      user: mockUserSignal.asReadonly(),
      loadUser: jasmine.createSpy('loadUser')
    };

    const authServiceMock = {
      logout: jasmine.createSpy('logout')
    };

    themeServiceSpy = jasmine.createSpyObj('ThemeService', ['cycleTheme'], {
      theme: mockThemeSignal.asReadonly()
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

  // --- Theme cycle row tests ---

  it('renders theme icon ⚙️ when theme is "system"', () => {
    mockThemeSignal.set('system');
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.theme-icon') as HTMLElement;
    expect(icon?.textContent?.trim()).toBe('⚙️');
  });

  it('renders theme icon ☀️ when theme is "light"', () => {
    mockThemeSignal.set('light');
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.theme-icon') as HTMLElement;
    expect(icon?.textContent?.trim()).toBe('☀️');
  });

  it('clicking the theme row calls themeService.cycleTheme() and keeps dropdown open', () => {
    component.dropdownOpen.set(true);
    fixture.detectChanges();
    const items = fixture.nativeElement.querySelectorAll('.dropdown-item') as NodeListOf<HTMLButtonElement>;
    items[2].click(); // Theme row is index 2
    fixture.detectChanges();
    expect(themeServiceSpy.cycleTheme).toHaveBeenCalled();
    expect(component.dropdownOpen()).toBeTrue();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```
Expected: new theme tests fail; Sign out test at old index fails.

- [ ] **Step 3: Update `navbar-avatar.ts`**

Replace the full file:

```typescript
import { Component, HostListener, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService, Theme } from '../../../core/services/theme.service';

const THEME_ICONS: Record<Theme, string> = {
  system: '⚙️',
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
          <button class="dropdown-item dropdown-item--theme" role="menuitem" (click)="cycleTheme($event)">
            <span class="theme-label">Theme</span>
            <span class="theme-right">
              <span class="theme-name">{{ themeService.theme() }}</span>
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

    .dropdown-item:hover {
      background: var(--color-border-row);
    }

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

    .dropdown-item--danger {
      color: var(--color-destructive);
    }

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
  readonly themeIcon = computed(() => THEME_ICONS[this.themeService.theme()]);

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

  cycleTheme(event: Event): void {
    event.stopPropagation(); // keep dropdown open
    this.themeService.cycleTheme();
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
git commit -m "feat(client): add theme cycle toggle to navbar avatar dropdown"
```

---

## Task 6: Angular — preferences model/service cleanup

**Files:**
- Modify: `plnd_client/src/app/core/models/preferences.ts`
- Modify: `plnd_client/src/app/core/services/preferences.service.ts`
- Modify: `plnd_client/src/app/core/services/preferences.service.spec.ts`

`Theme` now lives in `ThemeService`. `UpdatePreferencesRequest` is gone (no PATCH route). `updatePreferences()` is removed from the service.

- [ ] **Step 1: Update `preferences.ts`**

Replace the full file:

```typescript
export interface UserPreferences {
  user_id: string;
  created_at: string;
  updated_at: string;
}
```

`Theme` and `UpdatePreferencesRequest` are removed. `Theme` is exported from `theme.service.ts`.

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

Replace the full file (remove `updatePreferences` test and `theme` from mock):

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
   - Open the app and click the avatar — see the Theme row with ⚙️ / "system"
   - Click Theme row several times — icon cycles ⚙️ → ☀️ → 🌙 → ⚙️, `data-theme` attribute on `<html>` updates instantly, dropdown stays open
   - Refresh the page — theme persists from `localStorage`
   - Navigate to Settings — theme select reflects current theme, changing it applies instantly
   - Sign out and back in — theme is not reset (it's device-local)
