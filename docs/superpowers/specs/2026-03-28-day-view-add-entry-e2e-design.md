# Design: Day View — Add Entry E2E Tests

**Date:** 2026-03-28
**Issue:** calteran/plnd#101
**Phase:** 2.5 — Remaining Planning UI

---

## Context

The `AddEntryComponent` is a smart form embedded at the bottom of the Day View schedule list. It parses free-text input and morphs its UI based on detected entry type:

- **Exercise** — matches `/\b(run|walk|jog|cycle|swim|workout|gym|stretch|yoga|hike|bike)\b/i` → shows a duration (minutes) field
- **Appointment** — matches `/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i` → shows a time picker and location field
- **Task (default)** — any other text → no extra fields

The component lives at `plnd_client/src/app/features/schedule/components/add-entry/add-entry.ts` and is rendered inside `DayViewComponent` only when `scheduleItems.length > 0`. Unit tests exist (`add-entry.spec.ts`) but E2E coverage is absent.

Two features are deferred and must be marked `test.fail()`:
1. **Parse hints** — `parseHint()` always returns `null` (LLM integration deferred)
2. **Submission result** — `DayViewComponent.onItemAdded()` is a TODO stub; the added entry does not yet appear in the schedule list

---

## Approach

**Option A — New test file + extend `DayViewPage`** (selected)

Add-entry locators go into the existing `DayViewPage` page object to keep all day-view selectors in one place. A new dedicated file `e2e/tests/day-view-add-entry.e2e.ts` holds all add-entry scenarios, keeping the existing `day-view.e2e.ts` focused on routing, header, and schedule-state tests.

---

## Files Changed

### `plnd_client/e2e/pages/day-view.page.ts` — extend with add-entry helpers

```
getAddRow()          → .add-row (the "Add something…" trigger)
getEntryInput()      → .entry-input (the free-text field)
getMorphExercise()   → .morph-form--exercise
getMorphAppointment()→ .morph-form--appointment
getAddButton()       → button.btn-add
getCancelButton()    → button.btn-cancel
openAddEntry()       → async: click add row, wait for entry input visible
```

### `plnd_client/e2e/tests/day-view-add-entry.e2e.ts` — new test file

Single `test.describe('Day View — Add Entry', ...)` block. Uses the same `seedAuth` helper pattern as `day-view.e2e.ts`. All tests navigate to `/day/2026-03-28` and wait for the schedule list before interacting.

#### Test scenarios

| # | Scenario | Status |
|---|----------|--------|
| 1 | "Add something…" row is visible in the schedule list | Active |
| 2 | Clicking it opens the entry input | Active |
| 3 | Typing an exercise keyword shows the duration field | Active |
| 4 | Typing a time pattern shows time + location fields | Active |
| 5 | Generic text shows no morph fields (task default) | Active |
| 6 | Cancel button closes the form and clears text | Active |
| 7 | Escape key closes the form | Active |
| 8 | Add button is disabled when input is empty | Active |
| 9 | Parse hint updates based on detected type | `test.fail()` — `parseHint()` returns null |
| 10 | Submitting adds the entry to the schedule list | `test.fail()` — `onItemAdded` is a TODO stub |

#### Mock data strategy

- Auth: `seedAuth(page)` (same as existing tests) — sets `localStorage` token, stubs `/users/me`, `/preferences/me`, `/schedule/plan/status`
- Schedule items: no additional mocking needed; `ScheduleService.loadDay()` currently uses a `setTimeout`-based mock that always returns two items (Breakfast + Morning stretch), ensuring the schedule list renders
- POST interception for scenario 10: `page.route('**/schedule**', ...)` returning a mock created entry — included in the `test.fail()` test as documentation

---

## Key Constraints

- `app-add-entry` is only rendered inside `.schedule-list`, so tests must wait for `getScheduleList()` to be visible before asserting add-entry elements.
- The `parseHint` and submission scenarios are intentionally marked `test.fail()` with TODO comments pointing to the deferred work, following the same convention used in `day-view.e2e.ts`.
- No new routes or backend endpoints are needed for the active tests.

---

## Success Criteria

- All 8 active tests pass in headless Chrome via `just test-ci`
- 2 `test.fail()` tests are present as placeholders and fail as expected
- `just verify` passes cleanly
