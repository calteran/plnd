---
title: "E2E: Planning Wizard — Step 3 Meals Planning"
date: 2026-03-29
issue: "#106"
---

## Overview

Add Playwright e2e coverage for Step 3 of the Planning Wizard: the meals grid. Closes #106.

## File Structure

- **New file:** `plnd_client/e2e/tests/planning-wizard-step3.e2e.ts`
- **Existing file unchanged:** `plnd_client/e2e/tests/planning-wizard.e2e.ts` (guards, nav, steps 1 & 2 stay put)
- **New issue opened** to extract steps 1 & 2 into their own files (future cleanup)

## Seed Setup

`beforeEach` pre-seeds `plnd:plan-draft` in localStorage:

```json
{
  "schemaVersion": 1,
  "planStart": "2026-03-30",
  "planEnd": "2026-04-01",
  "currentStep": 3,
  "carryoverDecisions": {},
  "scheduledMeals": {},
  "scheduledTasks": [],
  "floatingTasks": [],
  "savedAt": "2026-03-29T00:00:00.000Z"
}
```

3-day horizon (Mon 2026-03-30 → Wed 2026-04-01) keeps the grid compact and assertions unambiguous. All cells start in pending state (`scheduledMeals: {}`). `seedWizard(page)` provides auth + API mocks.

## Test Scenarios

### Grid structure
- `.meals-grid` renders 3 `.cell-day-header` elements
- `.meals-grid` renders 3 `.cell-slot-label` elements (Breakfast / Lunch / Dinner)
- Grid contains 9 `.gc` cells total (3 days × 3 slots)

### Day headers
- Headers show correct day names: `MON`, `TUE`, `WED`
- Headers show correct dates: `Mar 30`, `Mar 31`, `Apr 1`

### Pending cell interaction
- A pending cell shows `.gc-pick` and `.gc-suggest` buttons
- Clicking `.gc-pick` opens the inline editor (`.mock-input` appears, `.gc-editing` applied to cell)
- Typing a name and pressing Enter fills the cell (`.custom-g` applied, `.gc-text.custom-t` shows typed text)
- Pressing Escape cancels without saving (cell returns to pending state)

### Custom meal cell
- A filled cell shows the meal title in `.gc-text.custom-t`
- Clicking `.gc-x` on a custom cell clears it back to pending

### Skip / undo
- Clicking `.gc-x` on a pending cell applies `.skipped-g` and shows `— skipped`
- Clicking `.gc-undo` on a skipped cell restores pending state

### Persistence
- Meals state survives navigating to Step 4 and back to Step 3

### Autocomplete — `test.fail()` (phase-3)

These two scenarios are marked `test.fail()` because autocomplete is not yet implemented. The component uses a plain `<input class="mock-input">` with no dropdown; see `TODO(phase-3)` in `week-plan.ts:104`.

- Typing in `.mock-input` shows a suggestion dropdown
- Clicking a suggestion fills the cell and closes the editor

## Key Selectors

| Selector | Purpose |
|---|---|
| `.meals-grid` | Grid container |
| `.cell-day-header` | Day column header (day name + date) |
| `.day-name` | Day name within header |
| `.day-date` | Date within header |
| `.cell-slot-label` | Row label (Breakfast / Lunch / Dinner) |
| `.gc` | Individual meal cell |
| `.gc.gc-editing` | Cell in inline-edit mode |
| `.gc.custom-g` | Cell with a user-set meal |
| `.gc.skipped-g` | Cell explicitly skipped |
| `.gc-pick` | Open inline editor button |
| `.gc-suggest` | Cycle suggestion button |
| `.gc-x` | Skip or clear button |
| `.gc-undo` | Undo skip button |
| `.mock-input` | Inline text input |
| `.gc-text.custom-t` | Custom meal title text |
