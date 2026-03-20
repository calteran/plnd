# Dark Mode Toggle — Design Spec

**Date**: 2026-03-20
**Status**: Approved

## Context

The app already supports three themes (`system`, `light`, `dark`) via a `user_preferences.theme` column in the database. However, theme is a per-device preference — a user may want dark mode on their laptop but light on their phone. Storing it in the database creates undesirable cross-device sync.

This change moves theme preference to `localStorage` (per-device, instant, no network) and adds a toggle button to the avatar dropdown for quick access. The device OS preference is the user's natural choice; the toggle allows overriding it for this app only. The existing Settings page theme section is removed — a per-device toggle belongs in the navbar, not settings. The `theme` column is removed from the backend entirely.

## Design Decisions

- **Interaction**: 2-state toggle in the avatar dropdown (device preference ↔ override). Button shows current effective theme (☀️ light / 🌙 dark). Dropdown stays open after click.
- **Persistence**: `localStorage` only, key `plnd_theme_override`. Value `'1'` when overriding device preference; key absent when following device preference. No backend involvement.
- **Backend cleanup**: `theme` column dropped via migration; Rust structs, routes, and validation updated accordingly.
- **Settings page**: Theme section removed entirely. The per-device toggle belongs in the navbar, not settings.

## Architecture

### New: `ThemeService`

`plnd_client/src/app/core/services/theme.service.ts`

Single source of truth for theme state across the app. Reads the device OS preference once at construction and an override flag from localStorage.

```
ThemeService
  effectiveTheme: Signal<'light' | 'dark'>  ← computed: device XOR override
  isOverridden:   Signal<boolean>            ← seeded from localStorage on init
  toggle(): void                             ← flips override; writes localStorage
```

`deviceDark` is captured once at service construction via `window.matchMedia('(prefers-color-scheme: dark)')`. The `effectiveTheme` computed depends only on `isOverriddenSignal` as a reactive dependency; it evaluates as:

```
useDark = isOverridden ? !deviceDark : deviceDark
effectiveTheme = useDark ? 'dark' : 'light'
```

`toggle()` sets the flag and writes or removes `localStorage.plnd_theme_override`.

### `AppComponent` (`app.ts`)

Replace the existing `preferencesService.loadPreferences()` startup call and theme effect with a single effect reading `themeService.effectiveTheme()`. Remove `PreferencesService` injection from this file. No matchMedia logic is needed here — `effectiveTheme` always resolves to `'light'` or `'dark'`.

```
effect(() => {
  document.documentElement.setAttribute('data-theme', themeService.effectiveTheme());
});
```

### `NavbarAvatarComponent` (`navbar-avatar.ts`)

- Inject `ThemeService`
- Add a "Theme" row between Settings and the divider:
  - Left: muted "Theme" label
  - Right: effective theme name (`light` / `dark`) + icon (☀️ / 🌙)
  - Clicking the row calls `themeService.toggle()`; dropdown stays open via `event.stopPropagation()`
- Replace all hardcoded colors with design tokens so the dropdown renders correctly in dark mode:
  - `#fff` → `var(--color-surface-white)`
  - `#374151` → `var(--color-text-body)`
  - `#f3f4f6` hover → `var(--color-border-row)`
  - `#6366f1` avatar bg → `var(--color-accent)`
  - `#dc2626` sign-out → `var(--color-destructive)`

### `SettingsComponent` (`settings.ts`)

- Remove `PreferencesService` dependency and the `@if (!preferencesService.preferences())` loading guard
- Remove the theme `<select>` and all theme-related code; remove `ReactiveFormsModule`
- The component becomes a minimal placeholder: back button + heading + "More settings coming soon"

### Models & Services

- `preferences.ts`: Remove `Theme` type export; remove `theme` field from `UserPreferences`; remove `UpdatePreferencesRequest` entirely
- `preferences.service.ts`: Remove `updatePreferences()` method
- `auth.service.ts`: `logout()` keeps calling `preferencesService.clearPreferences()` — harmless, method is retained

## Backend Changes

### Migration

`plnd_api/migrations/0014_remove_theme_from_preferences.sql`

```sql
ALTER TABLE user_preferences DROP COLUMN theme;
```

### Rust

- `db/preferences.rs`: Remove `theme` field from `UserPreferences` struct; remove from SELECT/RETURNING clauses; remove `upsert()` entirely
- `routes/preferences.rs`: Remove `VALID_THEMES` constant; remove `UpdatePreferencesRequest`; remove `patch_preferences` handler
- `main.rs`: Remove `.route("/preferences/me", patch(...))` and the unused `patch` import from axum routing
- GET `/preferences/me` remains unchanged

## Error Handling

- `ThemeService` reads `localStorage` at init — any value other than `'1'` (or key absent) means `isOverridden = false`. No invalid states possible.
- No network calls; no error states needed
- Theme change is instant and local — no rollback scenario

## Testing

### New: `theme.service.spec.ts`
1. `isOverridden` defaults to `false` when `plnd_theme_override` is absent
2. `isOverridden` reads `true` when localStorage contains `plnd_theme_override='1'` on init
3. `toggle()` sets `isOverridden` to `true` and writes `plnd_theme_override='1'`
4. `toggle()` a second time sets `isOverridden` to `false` and removes the key
5. `effectiveTheme()` returns `'dark'` when device is light and override is active
6. `effectiveTheme()` follows device preference when override is inactive

### Updated: `app.spec.ts`
- Remove `provideHttpClientTesting()`; use real `ThemeService` (no HTTP deps)
- Confirm `data-theme` is set to `effectiveTheme()` value after `toggle()`

### Updated: `navbar-avatar.spec.ts`
1. Renders ☀️ when `effectiveTheme` is `'light'`
2. Renders 🌙 when `effectiveTheme` is `'dark'`
3. Clicking the Theme row calls `themeService.toggle()` and keeps dropdown open

### Updated: `settings.spec.ts`
- Full rewrite — all existing tests relied on `PreferencesService` HTTP mocks. Theme section is gone.
- New tests: component creates without errors; back navigation works; no loading guard.

### Updated: `preferences.service.spec.ts`
- Remove `updatePreferences` test; remove `theme` from `mockPrefs`

### Backend
- Delete `plnd_api/tests/preferences_test.rs` entirely (both tests reference deleted struct fields)

## Verification

1. `just verify-build` — confirms Rust compiles after migration + struct changes
2. `just test-ci` — full suite (Rust + Angular headless)
3. Manual smoke test:
   - Open avatar dropdown → click Theme row → icon flips (☀️↔🌙), `data-theme` attribute toggles, dropdown stays open
   - Refresh page → confirm override state persists from `localStorage`
   - Open Settings → confirm no theme control (placeholder only)
   - Sign out and back in → confirm theme is still device-local (not reset by login)

## Files Changed

### Frontend
- `plnd_client/src/app/core/services/theme.service.ts` *(new)*
- `plnd_client/src/app/app.ts`
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.ts`
- `plnd_client/src/app/features/settings/settings.ts`
- `plnd_client/src/app/core/models/preferences.ts`
- `plnd_client/src/app/core/services/preferences.service.ts`

### Backend
- `plnd_api/migrations/0014_remove_theme_from_preferences.sql` *(new)*
- `plnd_api/src/db/models/mod.rs`
- `plnd_api/src/db/preferences.rs`
- `plnd_api/src/routes/preferences.rs`
- `plnd_api/src/main.rs`

### Tests
- `plnd_client/src/app/core/services/theme.service.spec.ts` *(new)*
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts`
- `plnd_client/src/app/features/settings/settings.spec.ts`
- `plnd_client/src/app/app.spec.ts`
- `plnd_client/src/app/core/services/preferences.service.spec.ts`
- `plnd_api/tests/preferences_test.rs` *(deleted)*
