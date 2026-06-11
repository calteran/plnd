# Design — Surface logging a meal as consumed/skipped (#890)

**Date:** 2026-06-11
**Issue:** [#890](https://github.com/calteran/plnd/issues/890) — wire `set_status` into the API + day view
**Status:** Approved, pending implementation plan

## Problem

[#829](https://github.com/calteran/plnd/issues/829) added the storage mechanism for meal
consumption tracking: `meal_anchor_instances` carries a `status`
(`planned`/`consumed`/`skipped`) and a `consumed_at` timestamp, exposed via
`MealAnchorInstanceRepository::set_status`. `yesterday_snapshot.meals_logged` counts
`status = 'consumed'` instances.

There is **no production code path** that calls `set_status`. As a result `meals_logged`
always reads 0 in production; the metric is exercised only in tests.

### What the exploration found

The day-view UI affordances already exist but are misrouted and inert:

- `meal-row` renders a "done" checkbox and a Review pane (`meal-review-pane`) with
  **Skip** and **Mark done** buttons.
- Both the checkbox and the pane buttons flow through `ScheduleService.toggleItem` /
  `skipMeal`, which `PATCH /schedule/entries/{id}/status` — the **schedule-entries**
  endpoint — passing a `meal_anchor_instances` ID. That ID is not a schedule entry, so
  the write is a silent no-op. This is precisely why `set_status` is never reached.
- The status never round-trips: `MealAnchorInstanceResponse` omits `status`/`consumed_at`,
  and `mapAnchorInstance` hardcodes `status: 'unplanned'`. Even a successful write could
  not be reflected on reload.

### Vocabulary

The backend uses meal-specific consumption states `planned` / `consumed` / `skipped`
(deliberately **not** the task status vocabulary, per `meal_anchor_instance.rs` doc
comments). The frontend `MealAnchor.status` uses `done` / `planned` / `unplanned` /
`skipped`. A mapping layer is required (`consumed ↔ done`).

## Scope

In scope:

- An API endpoint to set a meal anchor instance's consumption status
  (consumed / skipped / revert to planned).
- Make the consumption status round-trip through the read model.
- Rewire the existing day-view affordances (checkbox + Review pane Skip/Done) to the new
  endpoint.
- A visual treatment for skipped meals.

Out of scope (explicitly): merging planned-dish info into the anchor mapping — i.e. the
`planned` vs `unplanned` *dish-state* distinction. That is
[#479](https://github.com/calteran/plnd/issues/479) territory and not required to close
this gap.

## Design

### Backend (`plnd_api`)

**1. Expose status on the read model.** Add `status: String` and
`consumed_at: Option<DateTime<Utc>>` to `MealAnchorInstanceResponse` and populate them in
the `From<plnd_data::models::MealAnchorInstance>` impl.

**2. New endpoint:** `PATCH /schedule/anchors/{id}/status`

- Request body: `{ "status": "planned" | "consumed" | "skipped" }`, deserialized directly
  into the existing `MealConsumptionStatus` enum. Its serde `snake_case` rename already
  matches the wire vocabulary; an unknown value produces a 422 automatically (axum JSON
  rejection), so no hand-rolled validation list is needed.
- Calls `state.repos.meal_anchor_instance.set_status(id, user_id, status)`.
- Returns the updated `MealAnchorInstanceResponse` (`200`), or `404` when the row does not
  exist / belongs to another user (`set_status` returns `None`).
- **No date guard.** Past-date logging is allowed per architecture.md §4.6.
- Mirrors the shape of the existing `patch_entry_status` handler. Registered in
  `main.rs` (route) and `openapi.rs` (path + schema).

### Frontend (`plnd_client`)

**3. DTO + mapping.** Add `status: string` and `consumed_at: string | null` to
`MealAnchorInstanceDto`. `mapAnchorInstance` maps backend → `MealAnchor.status`:

| Backend     | `MealAnchor.status` |
|-------------|---------------------|
| `consumed`  | `done`              |
| `skipped`   | `skipped`           |
| `planned`   | `unplanned`         |

`planned → unplanned` preserves today's default behaviour; the dish-state distinction is
out of scope (see Scope).

**4. Rewire the controls.** In `day-view`:

- `(toggled)` on `app-meal-row` (the *during-meal tasks*, which are real schedule
  entries) stays on `ScheduleService.toggleItem` — unchanged.
- `(doneToggle)` and `(skipped)` move off the misrouted `/schedule/entries/...` path to a
  new `ScheduleService.setMealConsumption(id, status)` method that
  `PATCH /schedule/anchors/{id}/status`, applies an optimistic local update, and reloads
  the day on error.
- Checkbox toggles `consumed ↔ planned` based on current state. Review-pane **Skip** sets
  `skipped`; **Mark done** sets `consumed`.
- The old `skipMeal` method is removed.

**5. Skipped display.** `meal-row` applies a `meal-band--skipped` modifier class when
`meal().status === 'skipped'`: reduced opacity on the row and `line-through` on the meal
name, so a skipped meal reads as intentionally passed over but stays visible.

## Testing

- **Backend handler test:** consumed / skipped / planned / invalid-value (`422`) /
  unknown-id (`404`); assert `status` is present in the response body.
- **Angular unit:**
  - `meal-row.spec` — skipped styling applied on `status === 'skipped'`; checkbox emits a
    consumed intent.
  - `schedule.service.spec` — `setMealConsumption` targets the `/schedule/anchors/{id}/status`
    endpoint, optimistic update applied, rollback (reload) on error.
- **E2E (acceptance path):** seed a meal anchor on *yesterday*, mark it consumed via the
  day view, load today's briefing, assert `meals_logged` reflects the consumed meal.

## Acceptance

- A user can mark a meal consumed from the day view; `meals_logged` in the next briefing
  reflects it.
- An e2e test covers the log-a-meal → briefing path.
