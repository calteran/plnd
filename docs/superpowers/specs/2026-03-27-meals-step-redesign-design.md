# Meals Step Redesign — Design Spec

**Issue:** calteran/plnd#61 — fix(planning): redesign meals step as a day/slot grid (#48.4)
**Date:** 2026-03-27
**Scope:** `plan-meals-step.ts`, `plan-meals-step.spec.ts`

---

## Problem

`PlanMealsStepComponent` renders a flat list: for each day, an `h3` heading followed by `div.meal-slot` rows. Three issues:

1. **No visual structure** — days are not separated, making it hard to scan the week
2. **Wrong interaction model** — the current "Accept / Skip" buttons imply an explicit confirmation step; advancing the wizard should be the acceptance gesture
3. **No way to override a suggestion** — the user can only accept the suggestion as-is or skip the slot entirely; there is no path to enter their own meal or request a different suggestion

---

## Design

### Layout: day × slot grid

The step renders a CSS grid with **meal slots as rows** (Breakfast / Lunch / Dinner) and **days as columns**.

```
         Mon    Tue    Wed    Thu    Fri
         ─────  ─────  ─────  ─────  ─────
Breakfast  [ ]    [ ]    [ ]    [ ]    [ ]
Lunch      [ ]    [ ]    [ ]    [ ]    [ ]
Dinner     [ ]    [ ]    [ ]    [ ]    [ ]
```

**Grid structure:**
- `display: grid`, `grid-template-columns: 68px repeat(N, 1fr)` where N = `horizonDays().length`
- First column: slot row labels
- Remaining columns: one per day
- Gap: `5px`
- `overflow-x: auto` on the wrapper for narrow viewports

**Day column headers** use the accordion band style from `plan-tasks-step` — not a bordered box:
- `background: var(--color-surface-warm)`, `border-bottom: 2px solid var(--color-border-meal)`
- `border-radius: 8px 8px 0 0` — rounded top only (reads as heading, not cell)
- Day name: `11px`, `800w`, `uppercase`, `letter-spacing: 0.07em`, `var(--color-text-primary)`
- Short date: `9px`, `var(--color-text-muted)`

**Slot row labels** (left column):
- `9px`, `800w`, `uppercase`, `letter-spacing: 0.06em`, `var(--color-text-muted)`
- Right-aligned, vertically centered

---

### Cell interaction model

**Core principle:** advancing to the next step implicitly accepts all pending suggestions. Explicit action is only needed to override or skip.

Each cell has three controls:

| Control | Position | Appearance | Tooltip |
|---|---|---|---|
| **✏️ Pick** | bottom-left | ghost button, `transparent` bg, `rgba(0,0,0,0.08)` border | "Pick your own meal" |
| **🔀 Suggest** | bottom-right | ghost button, same style | "Try a different suggestion" |
| **× Skip** | top-right corner | `position: absolute`, `opacity: 0.25`, no border | "Skip this meal" |

Ghost buttons gain color on hover only: Pick → `var(--color-accent-light)` / `var(--color-accent-border)`; Suggest → `var(--color-surface-base)` / `var(--color-border-row)`.

---

### Cell states

**Pending suggestion** (default):
- Meal suggestion text: `11px`, italic, `opacity: 0.75`, `var(--color-text-body)`
- ✏️ Pick + 🔀 Suggest buttons at bottom; × in top-right corner

**Entering own meal** (after ✏️ Pick):
- Text input replaces suggestion; `border-bottom: 1.5px solid var(--color-accent-border)`
- Cell border: `var(--color-accent-border)`, `box-shadow: 0 0 0 2px var(--color-accent-light)`
- Confirm on Enter; cancel on Escape

**Custom meal entered:**
- Meal text: `11px`, `600w`, `var(--color-accent-dark)`, non-italic — visually distinct from suggestion
- Cell: `background: var(--color-accent-light)`, `border-color: var(--color-accent-border)`
- Bottom action: `✏️ edit` button (ghost, lightly tinted amber, `opacity: 0.75`)
- × corner still present (clears custom back to suggestion)

**Skipped:**
- Cell: `background: var(--color-surface-base)`, `opacity: 0.45`
- "— skipped" text; `undo` text link at bottom-right (restores suggestion)

---

### Data model

No changes to `week-plan.ts` types or `WeekPlanService`. The existing `scheduledMeals` signal (`Record<string, Partial<Record<MealSlot, PlannedMeal>>>`) is sufficient:

| Cell state | Service state |
|---|---|
| Pending suggestion | No entry in `scheduledMeals[date][slot]` |
| Custom meal entered | `setMeal(date, slot, { type: 'user_meal', title: … })` |
| Skipped | `setMeal(date, slot, { type: 'mock', title: '__skipped__' })` — sentinel value |

The "re-suggest" (🔀) action clears any existing entry and rotates to a different mock suggestion. A simple index offset (stored as local component state, not persisted) is sufficient for the mock phase.

The "pending suggestion" state is derived: a slot with no entry (or a cleared entry) shows `getMockSuggestion(date, slot)` and is treated as implicitly accepted at submission time.

The wizard has no per-step lifecycle hook — the meals step does not eagerly commit pending slots on navigation. Instead, the confirm/submit step reads `scheduledMeals` and treats any slot with no entry as an implicitly accepted suggestion, resolving it via `getMockSuggestion(date, slot)` at that point. Skipped slots (`__skipped__` sentinel) are filtered out and not submitted.

---

## Files Changed

| File | Change |
|---|---|
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts` | Full rewrite — grid template, cell states, icon buttons, inline input |
| `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts` | Update tests for new template and interaction model |

No new component files. No model or service changes.

---

## Out of Scope

- **Adding meals/snacks beyond the 3 standard slots** — tracked separately (follow-on to calteran/plnd#61)
- **Nutrition/ingredients info popup** — tracked separately (follow-on to calteran/plnd#61)
- **Real meal suggestions from the API** — mock suggestions remain; real provider integration is a Phase 3 concern (`TODO(phase-3)` already noted in `week-plan.ts`)
- **Drag-to-reorder or cross-day meal swapping**
