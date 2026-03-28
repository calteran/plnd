# Confirm Step Redesign — Spec

**Issue:** #63 (part of #48 planning UI redesign, step 6/6)
**File:** `plnd_client/src/app/features/planning/steps/plan-confirm-step/plan-confirm-step.ts`
**Date:** 2026-03-28

## Problem

The confirm step is visually inconsistent with the rest of the redesigned wizard:

- Stats render as a bare flex row with oversized `2rem` values — clashing with the 8–13px type scale used everywhere else.
- The "Finish Week Plan" button is small and `align-self: flex-end`, burying the primary action.
- The error message is an unstyled `<p>` with no container.
- The step lacks the satisfying completion feel called for by the issue.

## Design

### Header

Matches the pattern established by `plan-review-step`:

- `step-title`: "Confirm Your Plan" — `font-size: 13px; font-weight: 800; color: var(--color-text-primary)`
- `step-sub`: week range (e.g. "Mar 31 → Apr 6") — `font-size: 11px; color: var(--color-text-muted)`, with the date rendered as a small accent pill (same `week-range` style as the review step)

### Completion Banner

An `--color-accent-light` tinted container with `border: 1.5px solid var(--color-accent-border); border-radius: 10px`:

- Small emoji (✅) at the top
- Short heading: "Ready to go!" — `font-size: 13px; font-weight: 800; color: var(--color-accent-dark)`
- Three inline stats separated by thin `1px var(--color-accent-border)` vertical dividers:
  - **Days planned** · **Meal coverage %** · **Tasks**
  - Stat values: `font-size: 18px; font-weight: 800; color: var(--color-accent-dark)`
  - Stat labels: `font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-accent-dark); opacity: 0.7`

### Error Message

Rendered between the banner and the CTA when present:

```
background: #fdf2f2
border: 1px solid var(--color-destructive-border)   /* or #f5c6c6 fallback */
border-radius: 6px
padding: 7px 10px
font-size: 11px
color: var(--color-destructive)
```

Keeps `role="alert"` for accessibility.

### CTA Button

Full-width solid primary button:

```
display: block; width: 100%
background: var(--color-accent)
border: none
border-radius: 8px
padding: 12px
font-size: 14px; font-weight: 700; color: #fff
cursor: pointer
```

Disabled state: `opacity: 0.4; cursor: not-allowed`

Loading state label: "Saving…" (unchanged from current)

## What Does NOT Change

- All computed signals: `totalDays()`, `mealCoverage()`, `taskCount()`
- `finish()` method and its error/navigation logic
- `WeekPlanService` and `Router` injections
- The `mealCoverage` calculation (SKIP_SENTINEL logic)

## Implementation Notes

- The week-range subtitle needs `planStart()` and `planEnd()` signals (already on `weekPlanService`) formatted via a `formatWeekDate()` helper — identical to the one in `plan-review-step.ts`.
- `--color-destructive-border` may not exist in the design token set; fallback `#f5c6c6` is acceptable if the variable is absent.

## Scope

Single file: `plan-confirm-step.ts`. Template and styles only — no TypeScript logic changes beyond adding the `formatWeekDate` helper method.
