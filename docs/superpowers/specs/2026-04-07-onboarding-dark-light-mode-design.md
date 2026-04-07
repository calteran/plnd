# Onboarding Dark/Light Mode Design

**Date:** 2026-04-07
**Status:** Approved

## Context

The onboarding module was one of the first features built, before the project's visual identity and theming patterns were established. As a result, it uses hardcoded hex colors and inline styles instead of CSS custom property tokens, making it immune to the dark/light mode system that all other components already use.

The project has a complete theming foundation in place:
- `ThemeService` reads `prefers-color-scheme`, applies user overrides, and sets `data-theme` on `<html>`
- `_tokens.scss` defines full CSS variable palettes for both `[data-theme="light"]` and `[data-theme="dark"]`
- All other components already consume these tokens

The goal is to bring the onboarding UI into the same system — and in doing so, align it with the app's established brand colors (amber/warm in light mode, indigo in dark mode), replacing the legacy indigo-only palette it was originally built with.

## Scope

One component, two file changes:

1. **Create** `plnd_client/src/app/features/onboarding/onboarding.scss` — extracted and token-ified styles
2. **Modify** `plnd_client/src/app/features/onboarding/onboarding.ts` — remove inline styles block, reference the new `.scss` file

No changes to `_tokens.scss`, `theme.service.ts`, or `app.ts` — the infrastructure is already correct.

## Color Token Mapping

| Element | Current hardcoded value | Token |
|---|---|---|
| Shell background | `#f3f4f6` | `var(--color-surface-base)` |
| Card background | `#ffffff` | `var(--color-surface-white)` |
| Card shadow | `rgba(0,0,0,0.08)` | `var(--color-shadow-dropdown)` |
| Title text | `#111827` | `var(--color-text-primary)` |
| Body / description text | `#6b7280` | `var(--color-text-muted)` |
| Input border | `#d1d5db` | `var(--color-border-row)` |
| Input background | `#ffffff` | `var(--color-surface-white)` |
| Input focus border | `#6366f1` | `var(--color-accent)` |
| Progress bar fill | `#6366f1` | `var(--color-accent)` |
| Primary button bg | `#6366f1` | `var(--color-accent)` |
| Primary button hover | `#4f46e5` | `var(--color-accent-dark)` |
| Secondary button bg | `#e5e7eb` | `var(--color-border-row)` *(slightly lighter in light mode, but correct contrast on white card; `#333350` in dark mode gives a visible muted button)* |
| Secondary button text | `#1f2937` | `var(--color-text-primary)` |
| Step label / muted text | `#6b7280` | `var(--color-text-muted)` |
| Chip background | `#ede9fe` | `var(--color-accent-light)` |
| Chip text | `#7c3aed` | `var(--color-accent-dark)` |
| Error text | `#dc2626` | `var(--color-destructive)` |

**Note on brand alignment:** In the current onboarding, the primary button and progress bar use a fixed indigo (`#6366f1`). After this change, they will use `var(--color-accent)` — amber/orange in light mode, indigo in dark mode — matching the app's established brand. This is intentional.

## Constraints

- **No hex values in code.** Every color in `onboarding.scss` must reference a CSS custom property — no hardcoded hex, rgb, or hsl literals.
- **No new tokens.** All values must map to tokens already defined in `_tokens.scss`. If a color cannot be expressed with an existing token, use `color-mix()` against an existing token rather than introducing a new one.

## Implementation Approach

**Step 1 — Create `onboarding.scss`**

Extract the full inline styles block from `onboarding.ts` into a sibling `.scss` file. Replace every hardcoded color value with the corresponding CSS variable per the mapping above. Structural/layout rules (padding, max-width, border-radius, flex, transitions) are unchanged.

**Step 2 — Update `onboarding.ts`**

- Remove the `styles: [...]` array from the `@Component` decorator
- Add `styleUrl: './onboarding.scss'`
- No changes to component logic, template, or signals

## Verification

1. Run `just verify-build` — confirms the component compiles cleanly with the new stylesheet reference
2. Run `just test-ng-headless` — confirms no unit test regressions
3. Manual smoke test:
   - Open the app with system set to light mode → onboarding should use amber accent and warm surfaces
   - Switch system to dark mode → onboarding should use indigo accent and dark surfaces, no hard-coded colors visible
   - Step through all 3 onboarding steps in both modes — progress bar, form fields, chips, and buttons all respond correctly
