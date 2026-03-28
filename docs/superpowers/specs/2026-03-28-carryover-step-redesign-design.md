# Carryover Step Redesign — Design Spec

**Issue:** calteran/plnd#62
**Parent:** calteran/plnd#48 (planning UI redesign), execution order 5/6
**Date:** 2026-03-28

---

## Summary

Visual polish of `PlanReviewStepComponent` (`plan-review-step.ts`) to bring the carryover review step in line with the rest of the redesigned planning wizard. No architectural changes, no new components, no backend work.

---

## Scope

Four targeted improvements, all within the single component file:

1. **Row padding** — increase from `4px` to `11px` vertical (matches the `6–12px` range used in the tasks and meals steps)
2. **Decision control** — replace three plain bordered buttons with a single cycling badge; tapping rotates `accept → defer → dismiss → accept`
3. **Date display** — replace raw ISO date string with a formatted `Mon Mar 24` pill (small tag, `--color-surface-white` background, subtle border)
4. **Empty state** — replace bare `<p>` text with a styled card: 🎉 emoji, bold heading "All caught up!", and a reassuring subtitle

---

## Decision Control Detail

### Default state
All rows initialize with `accept` as the decision. This is consistent with the "acceptance is implicit" model already established in the meals step — the user only taps to change their mind.

The `WeekPlanService` already treats missing decisions as accepted, so this default is purely presentational. No service changes required.

### Cycling behavior
Each tap advances: `accept → defer → dismiss → accept`. The badge fills with a semantic color using CSS tokens only — no raw hex values in component styles.

### Color tokens

**All badge colors must use CSS custom properties.** The existing token file (`_tokens.scss`) already provides what we need for defer (reuses the accent/amber set) but is missing light/border variants for success and destructive. Three new token pairs must be added to `_tokens.scss` (with dark-mode overrides in `[data-theme="dark"]`):

| Token | Light mode | Dark mode |
|-------|-----------|-----------|
| `--color-success-light` | `#dcfce7` | `rgba(34, 197, 94, 0.15)` |
| `--color-success-border` | `#4ade80` | `#22c55e` |
| `--color-destructive-light` | `#fee2e2` | `rgba(239, 68, 68, 0.15)` |
| `--color-destructive-border` | `#f87171` | `#ef4444` |

Defer reuses the existing `--color-accent-light` / `--color-accent-border` / `--color-accent-dark` tokens (already amber, already dark-mode aware).

Badge color mapping:
- **Accept** — bg: `--color-success-light`, border: `--color-success-border`, text: `--color-success`
- **Defer** — bg: `--color-accent-light`, border: `--color-accent-border`, text: `--color-accent-dark`
- **Dismiss** — bg: `--color-destructive-light`, border: `--color-destructive-border`, text: `--color-destructive`

The badge shows a `▾` caret to signal it is interactive.

### Implementation note
The `decision()` helper currently returns `CarryoverDecision | undefined`. The badge display logic should treat `undefined` as `'accept'` (matching the service's own interpretation). The `decide()` call fires on every tap to keep the service state in sync.

---

## Date Display

Format: `toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })` — e.g. `Mon, Mar 24`.

Rendered as a small inline pill using CSS variables consistent with the task accordion headers:
- `font-size: 10px`, `font-weight: 600`
- `background: var(--color-surface-white)`, `border: 1px solid var(--color-border-row)`
- `border-radius: 4px`, `padding: 2px 7px`

---

## Empty State

Displayed when `weekPlanService.carryoverItems().length === 0` (after loading completes).

Structure:
```
🎉
All caught up!
No unfinished items from last week to review.
```

Styled as a centered card within the step content area, matching the border/radius/background pattern of other cards in the wizard.

---

## Out of Scope

- **Time-sensitive task flag** — tracked separately in calteran/plnd#81. The carryover step redesign does not attempt to distinguish stale items.
- **Randomized empty-state emoji** — tracked in calteran/plnd#82. The fixed 🎉 ships with this issue; randomization follows.
- **Service or backend changes** — none required.

---

## Files Changed

| File | Change |
|------|--------|
| `plnd_client/src/styles/_tokens.scss` | Add `--color-success-light`, `--color-success-border`, `--color-destructive-light`, `--color-destructive-border` with dark-mode overrides |
| `plnd_client/src/app/features/planning/steps/plan-review-step/plan-review-step.ts` | All visual changes (template + styles) |

---

## Verification

- `just verify` passes cleanly
- Populated state: rows show `11px` vertical padding, formatted date pill, cycling badge defaulted to Accept
- Cycling: tapping badge rotates through all three states with correct colors
- Empty state: renders 🎉 card when no carryover items exist
- Existing `ngOnInit` loading/error behavior unchanged
