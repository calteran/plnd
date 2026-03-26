# Wizard Shell Redesign — Design Spec

**Issue:** calteran/plnd#58 (subtask 1/6 of #48)
**Date:** 2026-03-26
**Scope:** `planning-wizard.ts` only — no new files, no new components

---

## Problem

The planning wizard shell has three visual inconsistencies with the rest of the app:

1. Progress bar shows plain numbered circles with no step labels
2. `.nav-btn` uses `font-size: 18px; font-weight: 700` — too heavy for the app's text scale
3. The wizard `<h1>` inherits the browser's oversized default; header padding doesn't match `.top-bar`

---

## Design

### 1. Progress Bar

Replace the current `readonly steps = [1, 2, 3, 4, 5]` array with a typed array of step objects:

```ts
readonly steps = [
  { n: 1, label: 'Carryover' },
  { n: 2, label: 'Tasks' },
  { n: 3, label: 'Meals' },
  { n: 4, label: 'Review' },
  { n: 5, label: 'Confirm' },
];
```

The template renders pill badges in a horizontal row with `›` separators between them:

```
[1 Carryover]  ›  [2 Tasks]  ›  [3 Meals]  ›  [4 Review]  ›  [5 Confirm]
```

**Pill states:**
- **Done** (step < current): `--color-accent-light` background, `--color-accent-border` border, `--color-accent-dark` text, number badge filled `--color-accent`
- **Active** (step === current): same amber fill, `--color-accent` border, bold label
- **Pending** (step > current): white background, `--color-border-row` border, `--color-text-muted` text

**Metrics:** pill height 28px, font-size 11px, number badge 16×16px. `›` separators use `--color-text-muted`.


### 2. Nav Button Fix

```css
.nav-btn {
  font-size: 16px;   /* was 18px */
  font-weight: 400;  /* was 700 — Unicode glyphs (‹ ›) don't need bold weight */
}
```

All other `.nav-btn` properties (background, border, padding, min-width/height, border-radius) remain unchanged. The 44×44px touch target is preserved.

### 3. Header / Padding

| Element | Before | After |
|---|---|---|
| `.wizard-header` padding | `1rem` | `0.75rem 1rem` (matches `.top-bar`) |
| `h1` font-size | browser default (~2rem) | `1.25rem` |
| `h1` font-weight | browser default (bold) | `800` |
| `h1` color | inherited | `var(--color-text-primary)` |

Content padding (`1rem`) and footer padding (`1rem`) are unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts` | Template + styles only |

No new files. No new components. No service or model changes.

---

## Out of Scope

- Step content changes (addressed in later sub-issues of #48)
- Nav button label/icon changes (keep `‹` / `›` glyphs)
