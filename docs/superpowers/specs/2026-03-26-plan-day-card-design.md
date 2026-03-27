# Plan Day Card Design Spec

**Issue:** calteran/plnd#59 — fix(planning): design day grid step cards (#48.2)
**Date:** 2026-03-26
**Status:** Approved

## Overview

`PlanDayCardComponent` currently has no styles — class names exist in the template but no `styles` array. This spec defines the visual treatment and animation for both collapsed and expanded card states.

## Design Decisions

### Card style (collapsed)
Option C: structured tile with a warm-tinted header band and labeled stat rows.

- **Header**: warm surface (`--color-surface-warm`) with amber bottom border (`--color-border-meal`), day name (uppercase, 11px, 800 weight) on the left, short date on the right.
- **Stats body**: two rows — `tasks` and `meals` — each showing a muted label and a small badge (9px, 3px×6px padding, 3px border-radius). Non-zero values use amber accent style; zero values use a quiet grey style.
- **Chevron**: small `▾` below the stats, signals expand affordance. Rotates 180° when expanded.
- **Width**: `min-width: 120px`, no fixed width — content determines width, capped at `max-width: 200px` for long task names.

### Expand behavior (expanded)
Option A: inline expand — card grows taller in place; other cards reflow with `align-items: flex-start` on the grid.

- **Border + header**: shift to full amber (`--color-accent` border, `--color-accent-light` header background) on expand.
- **Body**: reveals two sections — Meals and Tasks — separated by a section label row.
- **Meals section**: one row per slot (Breakfast / Lunch / Dinner); slot label in muted text, meal title in primary text, or an em-dash italic placeholder if unset.
- **Tasks section**: one row per task; task title on the left, energy badge on the right (color-coded: low = blue, medium = orange, high = red using existing `--color-energy-*` tokens).
- **Body is read-only** — edit affordances deferred to calteran/plnd#65.

### Animation
CSS `max-height` transition on `.card-body`:
- Collapsed: `max-height: 0`, `overflow: hidden`
- Expanded: `max-height: 400px` (sufficient ceiling for bounded content)
- Timing: `0.25s ease-out` (closing), `0.3s ease-in` (opening)
- Chevron rotation: `transform: rotate(180deg)` with `transition: transform 0.2s`

### Hover / focus states
- **Hover**: border shifts to `--color-accent-border`, subtle box-shadow `0 2px 8px rgba(217,119,6,0.10)`
- **Focus-visible**: `outline: 2px solid --color-accent`, `outline-offset: 2px` (keyboard accessibility)

## Files Changed

| File | Action |
|---|---|
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts` | Remove inline `styles`, add `styleUrl: 'plan-day-card.scss'`, add chevron element to template |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.scss` | **New** — all visual rules |
| `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-grid-step.ts` | Add `align-items: flex-start` to `.day-grid` style |

## Deferred

- Card interactivity (tap to edit meals/tasks): calteran/plnd#65

## Token Reference

All colors from `src/styles/_tokens.scss`:

```
--color-surface-warm      header background (collapsed)
--color-surface-white     card background
--color-border-meal       header bottom border
--color-border-row        default card border, body row separators
--color-text-primary      day name, meal/task titles
--color-text-muted        date, stat labels, slot labels
--color-text-secondary    (unused in card directly)
--color-accent            expanded card border
--color-accent-light      expanded header background, non-zero badge fill
--color-accent-border     hover border, expanded header border
--color-accent-dark       non-zero badge text
--color-energy-low        #4a6fa5  (blue)
--color-energy-medium     #e67e22  (orange)
--color-energy-high       #c0392b  (red)
```
