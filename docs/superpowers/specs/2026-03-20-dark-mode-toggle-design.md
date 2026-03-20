# Dark Mode Toggle — Design Spec

**Date**: 2026-03-20
**Status**: Approved

## Context

The app already supports three themes (`system`, `light`, `dark`) via a `user_preferences.theme` column in the database. However, theme is a per-device preference — a user may want dark mode on their laptop but light on their phone. Storing it in the database creates undesirable cross-device sync.

This change moves theme preference to `localStorage` (per-device, instant, no network) and adds a cycle toggle button to the avatar dropdown for quick access. The existing Settings page theme select is simplified to immediate-apply (no Save button needed). The `theme` column is removed from the backend entirely.

## Design Decisions

- **Interaction**: Cycle button in the avatar dropdown (system → light → dark → system). Dropdown stays open after click.
- **Persistence**: `localStorage` only, key `plnd_theme`. No backend involvement.
- **Backend cleanup**: `theme` column dropped via migration; Rust structs, routes, and validation updated accordingly.
- **Settings page**: Theme select stays for discoverability, but becomes immediate-apply via `ThemeService` (no pending state, no API call).

## Architecture

### New: `ThemeService`

`plnd_client/src/app/core/services/theme.service.ts`

Single source of truth for theme state across the app. Small, focused, no backend dependency.

```
ThemeService
  theme: Signal<Theme>       ← seeded from localStorage on init; defaults to 'system'
  setTheme(theme): void      ← writes localStorage + updates signal
  cycleTheme(): void         ← advances: system → light → dark → system
```

The `THEME_CYCLE: Theme[] = ['system', 'light', 'dark']` order is fixed. `cycleTheme()` uses `indexOf` + modulo.

### `AppComponent` (`app.ts`)

Replace the existing `preferencesService.loadPreferences()` startup call and theme effect with a single effect reading `themeService.theme()`. Remove `PreferencesService` injection from this file.

```
effect(() => {
  const theme = themeService.theme();
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', useDark ? 'dark' : 'light');
});
```

### `NavbarAvatarComponent` (`navbar-avatar.ts`)

- Inject `ThemeService`
- Add a "Theme" row between Settings and the divider:
  - Left: muted "Theme" label
  - Right: mode name label + icon button (⚙️ system / ☀️ light / 🌙 dark)
  - Clicking the row calls `themeService.cycleTheme()`; dropdown stays open
- Replace all hardcoded colors with design tokens so the dropdown renders correctly in dark mode:
  - `#fff` → `var(--color-surface-white)`
  - `#374151` → `var(--color-text-body)`
  - `#f3f4f6` hover → `var(--color-border-row)`
  - `#6366f1` avatar bg → `var(--color-accent)`
  - `#dc2626` sign-out → `var(--color-destructive)`

### `SettingsComponent` (`settings.ts`)

- Remove `PreferencesService` dependency; inject `ThemeService`
- Remove the `@if (!preferencesService.preferences())` loading guard (and any associated loading text) — the form no longer waits on an HTTP call
- Theme `<select>` becomes immediate-apply: `(change)` calls `themeService.setTheme(value)` directly
- Remove Save button, pending state, success/error messages (no API call)
- Remove `ReactiveFormsModule` dependency if theme was its only use

### Models & Services

- `preferences.ts`: Remove `Theme` type export; remove `theme` field from `UserPreferences` and `UpdatePreferencesRequest`
- `preferences.service.ts`: Remove `theme` from `updatePreferences()` request body
- `auth.service.ts`: `logout()` keeps calling `preferencesService.clearPreferences()` (no-op for theme now, harmless)

## Backend Changes

### Migration

`plnd_api/migrations/0012_remove_theme_from_preferences.sql`

```sql
ALTER TABLE user_preferences DROP COLUMN theme;
```

### Rust

- `db/preferences.rs`: Remove `theme` field from `UserPreferences` struct; remove from all SELECT and RETURNING clauses; remove COALESCE theme logic from `upsert()`
- `routes/preferences.rs`: Remove `VALID_THEMES` constant; remove `theme` field from `UpdatePreferencesRequest`; remove theme validation block from `patch_preferences` handler
- No route changes (GET/PATCH `/preferences/me` remain, now managing future preferences)

## Error Handling

- `ThemeService` reads `localStorage` with a `'system'` default if the key is absent or holds an unrecognised value
- No network calls; no error states needed
- Theme change is instant and local — no rollback scenario

## Testing

### New: `theme.service.spec.ts`
1. Defaults to `'system'` when localStorage is empty
2. Reads persisted value from localStorage on init
3. `cycleTheme()` advances correctly through all three states and wraps
4. `setTheme()` writes to localStorage and updates signal

### Updated: `navbar-avatar.spec.ts`
1. Renders correct icon for each theme value (`⚙️` / `☀️` / `🌙`)
2. Clicking the Theme row calls `themeService.cycleTheme()`
3. Dropdown stays open after theme row click

### Updated: `settings.spec.ts`
- Full rewrite — all existing tests relied on `PreferencesService` HTTP mocks (both `GET /preferences/me` for initial load and `PATCH /preferences/me` for save). With `PreferencesService` fully removed, all nine tests need to be replaced.
- New tests: provide `ThemeService` spy; assert `setTheme()` called on select change for each theme value; assert no loading guard / form renders immediately.

### Backend
- Update `tests/preferences_test.rs` to remove any theme field assertions

## Verification

1. `just verify-build` — confirms Rust compiles after migration + struct changes
2. `just test-ci` — full suite (Rust + Angular headless)
3. Manual smoke test:
   - Open avatar dropdown → click Theme row several times → confirm icon and `data-theme` attribute cycle correctly
   - Refresh page → confirm theme persists from localStorage
   - Open Settings → change theme select → confirm immediate visual update, no Save button
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
- `plnd_api/migrations/0012_remove_theme_from_preferences.sql` *(new)*
- `plnd_api/src/db/preferences.rs`
- `plnd_api/src/routes/preferences.rs`

### Tests
- `plnd_client/src/app/core/services/theme.service.spec.ts` *(new)*
- `plnd_client/src/app/shared/components/navbar-avatar/navbar-avatar.spec.ts`
- `plnd_client/src/app/features/settings/settings.spec.ts`
- `plnd_api/tests/preferences_test.rs` (if theme assertions exist)
