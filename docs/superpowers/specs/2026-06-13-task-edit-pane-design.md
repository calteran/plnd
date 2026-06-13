# Task edit pane in the day view — design

**Issue:** #914 (host the one-shot "skip if missed" setter) — used as the vehicle for a
fuller task-editing capability.
**Date:** 2026-06-13
**Status:** Design — pending implementation plan.

## 1. Purpose

#911 reduced the day-view one-shot affordance to a read-only indicator, leaving **no UI to
set or clear `one_shot` on the day itself**. Architecture §4.4 (line 299) states that *all*
task metadata is user-editable "on the day itself (in the day view)," and §4.9 (line 415)
requires capability parity between the day view and the planning surfaces. There is currently
no task-edit surface in the day view at all.

This design introduces an **inline task-edit pane** in the day view that hosts the one-shot
setter (#914's concrete ask) alongside the other day-editable task fields, establishing the
edit surface the architecture already calls for.

## 2. Scope

### In scope — the "core six" fields

A tapped task row expands into a compact inline form editing six flat, scalar fields:

| UI field          | Model field        | Control                                              |
| ----------------- | ------------------ | ---------------------------------------------------- |
| Title             | `title`            | text input (non-blank)                               |
| Type              | `task_type`        | select: Work / Exercise / Leisure / Medication / Appointment / General |
| Start time        | `scheduled_start`  | time input ("HH:MM"); see §6 for the floating-task boundary |
| Duration          | `duration_minutes` | number input (minutes, optional, positive)           |
| Energy            | `energy_required`  | select: Low / Medium / High                          |
| Skip if missed    | `one_shot`         | toggle — plain-language copy, never the internal name |

### Out of scope — deferred to tracking issues

The two remaining §4.4-editable fields are structurally heavier and are deferred:

- **Date** — moving an entry to another day can trigger lazy materialization (§4.6) and
  changes which day's list the entry belongs to.
- **Meal pairing / slot placement** — reassigning `slot_meal_anchor_id` / `after_anchor`
  needs an anchor-instance picker and touches the slot model (§4.8).

Both will get GitHub issues opened during implementation (per the "no deferred debt without a
tracking issue" rule). Deferring them also keeps the inline form genuinely compact — a date
picker or anchor picker would bloat a row-embedded form.

**Delete** of a task entry is not part of this design (no delete affordance exists today; it is
a separate capability, not a metadata edit).

## 3. UX

### Form factor: inline expansion with a focus "spotlight"

The chosen form factor (over a bottom sheet and a slide-over drawer) is **inline expansion**:
tapping a task row's label/body expands the form directly beneath that row.

Rationale (decided collaboratively):

- **Eyeline stays anchored.** The tapped row does not move; the form unfolds beneath it. A
  bottom sheet would force the eye/thumb to jump from a top-of-list row to the bottom of the
  viewport and back — a real cost on the mobile-primary day view (§9, line 912).
- **Motion is kept away from the focal point.** Only the rows *below* the expansion reflow —
  the region the user has stopped attending to. The edited row never jumps.
- **Focus without losing place — the "spotlight."** While a row is being edited, all other
  rows are visually **de-emphasized** (reduced opacity) and made **inert** (not tabbable, not
  clickable, removed from the a11y tab order). This recovers the one advantage a bottom sheet
  had — full focus on one task — *in place*, without dimming requiring an overlay that moves
  the eye. The faint surrounding rows keep spatial context so the user never loses their spot.

Mitigations baked in:

1. **Scroll-anchor** the expanded row: if the unfolded form would fall below the fold, gently
   scroll so the row + its form stay fully visible.
2. **Animate** the expand/collapse height transition, gated on `prefers-reduced-motion` so the
   reflow reads as a smooth unfold rather than a snap (and is instant for users who opt out of
   motion).

### Trigger and dismissal

- **Open:** tap the task row's **label/body**. The completion **checkbox keeps owning
  completion toggles** — the two actions stay spatially separate so an edit and a "mark done"
  never get crossed.
- **Only one editor open at a time.** Opening a second row closes the first.
- **Focus on open:** focus moves into the title field so keyboard/AT users land inside the form.
- **Dismiss:** the **Done** button or pressing **`Escape`** (from any control in the form) closes
  the editor and returns focus to the originating row. There is no modal "Cancel" — edits persist
  as made (see §5, save behavior).
- **Resolved contradiction (inert vs. tap-to-dismiss):** an earlier draft also said "tapping a
  de-emphasized row dismisses the editor." That cannot coexist with making the dimmed rows
  **`inert`** (which removes their pointer/focus events) — and `inert` is the stronger
  accessibility choice. We keep `inert`; the dismissal paths are therefore **Done** and
  **`Escape`**, not tapping a dimmed row.

## 4. Architecture & components

```
DayViewComponent
  ├─ owns editingId signal (which row, if any, is in edit mode)
  ├─ applies .dimmed + inert to rows where id !== editingId
  └─ for each task:
       app-task-row [item] [editing] [dimmed]
         ├─ (editRequested) — emitted on label tap → DayView sets editingId
         ├─ (toggled)       — existing completion toggle (unchanged)
         └─ when editing: hosts
              app-task-edit-form [task]
                ├─ (save)  — emits a TaskEditPatch (any of the six fields, incl. one_shot)
                └─ (close) — emits to clear editingId
```

- **`TaskEditFormComponent`** (new, isolated, independently testable): a reactive `FormGroup`
  over the six fields, plain-language labels, validation, and the accessibility contract
  (§7). It knows nothing about HTTP — it emits intent.
- **`TaskRowComponent`** gains `editing`/`dimmed` inputs and an `editRequested` output, and
  conditionally renders `app-task-edit-form`. Its existing read-only one-shot indicator
  remains for the collapsed state.
- **`DayViewComponent`** owns `editingId` and the spotlight/inert coordination; it routes the
  form's outputs to `ScheduleService`.

This keeps each unit single-purpose: the form is a dumb, testable control; the row owns its
collapsed/expanded presentation; the day view owns cross-row focus state and persistence
wiring.

## 5. Persistence

**One path for all six fields.** `one_shot` is a scalar field on the same row as the others,
with the same optimistic semantics — it is not fundamentally different, so it is **not** given
its own persistence path. (#914's prose suggested wiring the toggle to the retained
`setEntryOneShot`, but an issue is a transient snapshot, not a design constraint; consistency
across fields wins.)

All six fields go through a single new method
`ScheduleService.updateEntry(id, patch)` → new `PATCH /schedule/entries/{id}`, following the
existing **optimistic** pattern (`toggleItem`): apply the change to the `_items` signal
immediately, PATCH, and `loadDay()` to revert on error.

**Removal of the now-redundant dedicated one-shot path.** Folding `one_shot` into the general
endpoint makes these redundant; leaving them would recreate the "retained without a caller"
smell #911 left. They are **removed**, with their test coverage migrated onto the general
endpoint:

- client `ScheduleService.setEntryOneShot`
- route `PATCH /schedule/entries/{id}/one-shot` (`patch_entry_one_shot`) + `PatchEntryOneShotRequest`
- repository `ScheduleRepository::update_entry_one_shot` (trait + pg impl)

**Save behavior (resolved):** edits commit **per-field, optimistically** as the user leaves a
field — text inputs on blur (debounced), selects/number/toggle on change — consistent with the
app's established optimistic-immediate persistence. No explicit "Save" button; closing the
editor does not require a separate commit step.

## 6. Backend changes

The read path needs **no change**: `ScheduleEntryResponse` (`plnd_api/src/api_response.rs`)
already serializes `duration_minutes`, `energy_required`, and `scheduled_start`. The client
just doesn't consume them yet (see §8).

New write surface, added the storage-isolation-compliant way (no `sqlx`/`PgPool` in
`plnd_api`):

1. **HTTP** — `PatchEntryRequest` body in `plnd_api/src/models.rs` with all-optional fields:
   `title`, `task_type`, `scheduled_start` (HH:MM), `duration_minutes`, `energy_required`,
   `one_shot`. (`status` keeps its dedicated endpoint — it carries distinct lifecycle
   validation and is not a metadata edit.) A new `PATCH /schedule/entries/{id}` handler in
   `plnd_api/src/routes/schedule.rs` (auth → repo call → 204 / 400 / 404 / 500), with utoipa
   annotation. The dedicated one-shot route is removed (see §5).
2. **Validation** — `task_type` ∈ the task vocabulary (work/exercise/leisure/medication/
   appointment/general); `energy_required` ∈ {low, medium, high}; `duration_minutes` positive;
   `title` non-blank when present. Invalid → 400, mirroring `VALID_STATUSES`.
3. **Repository** — new `ScheduleRepository::update_entry(user_id, entry_id, patch)` trait
   method in `plnd_data` + its pg implementation, covering all six fields including `one_shot`.
   Partial update (`COALESCE`-style: only provided fields change), scoped by `user_id` for
   ownership; `NotFound` when no row matches. The old `update_entry_one_shot` is removed (§5).

### Floating-vs-fixed boundary (design decision — flag for review)

A task is either **fixed** (`scheduled_start` set) or **floating** (placed in a slot via
`after_anchor`, no `scheduled_start`); the two are mutually exclusive. This PR edits the
**time value of a task that is already fixed**, and does not convert a floating task into a
fixed one (or vice versa) — that conversion is slot/placement semantics, bundled with the
deferred meal-pairing work. Concretely: a floating task's editor shows the time field
**disabled with a hint** ("set by its meal slot"), rather than letting an edit orphan the task
into a no-slot/no-time state. This keeps the PR from pulling in placement logic.

## 7. Accessibility (per #914's explicit requirements)

- **Real controls** throughout — native `input`/`select`/button; the one-shot toggle uses
  `role="switch"`/checkbox semantics with `aria-checked`/`aria-pressed`.
- **State-dependent `aria-label`** on the one-shot control and a persistent plain-language
  label; **never expose the internal `one_shot` name** — copy is "skip if missed" with the
  precedent helper text "won't carry over if not done."
- **Focus management:** opening moves focus to the first field; `Escape` closes and restores
  focus to the originating row; de-emphasized rows are `inert` (out of tab order).
- The expanded form is a labelled region (`aria-label` "Edit task: {title}").
- Animation respects `prefers-reduced-motion`.

## 8. Client model changes

- Extend `ScheduleEntryDto` (`week-plan.ts`) to include `duration_minutes` and
  `energy_required` (already returned by the API).
- Extend `ScheduleTask` (`schedule.ts`) with `durationMinutes?`, `energy?`, and surface the
  scheduled time (the existing `scheduledTime?` field is presently unpopulated by `mapEntry`).
- Update `mapEntry()` to populate the new fields and the time-of-day from `scheduled_start`.
- Add `TaskEditPatch` type + `ScheduleService.updateEntry(id, patch)` (optimistic, reload on
  error).

## 9. Testing

- **Angular unit (`TaskEditFormComponent`, `TaskRowComponent`, `DayViewComponent`):** label
  tap opens the editor; only one open at a time; spotlight dims + makes others inert; field
  edits (all six, including the one-shot toggle) emit a `TaskEditPatch` routed to `updateEntry`;
  validation blocks blank title / bad duration; a11y attributes; `Escape` closes and restores
  focus; `prefers-reduced-motion` path. Use provider APIs (`provideHttpClientTesting`, etc.),
  never the deprecated testing NgModules.
- **Service:** `updateEntry` optimistic update + reload-on-error (covers `one_shot` too). The
  removed `setEntryOneShot` spec is deleted; its one-shot persistence assertions move here.
- **Rust unit:** `PatchEntryRequest` validation (valid/invalid type, energy, duration, blank
  title), mirroring the existing `map_entry` test module.
- **Rust integration:** `update_entry` repository method — partial update (including `one_shot`),
  ownership scoping, `NotFound`. The removed `update_entry_one_shot` tests fold into these.
- **E2E (real backend — schedule endpoints are not mocked):** open the inline editor from a
  seeded task, change title + type + one-shot, confirm persistence survives a reload. Seed via
  the real API helpers (`seedScheduleEntries`), per the e2e mock policy.

## 10. Architecture compatibility checklist

- §4.4 "all task metadata is user-editable … in the day view" — this is the day-view edit
  surface; core six now, remaining two tracked.
- §4.9 capability parity — the day view gains task-edit capability the planning surfaces have;
  the field set and copy align so parity holds (full parity completes when date + meal-pairing
  land).
- §3.5 memory feedback — edits persist through the normal schedule write path; the memory
  system observes persisted changes downstream. No direct memory call required from the pane.
- Storage isolation — new query lives behind a `ScheduleRepository` method in `plnd_data`;
  `plnd_api` calls the trait only; no `sqlx` leak.
- Sensory-friendly / quiet-by-default — spotlight + scroll-anchor + reduced-motion-aware
  animation; no persistent per-row clutter (the #911 concern), since editing is a deliberate
  tap, not an always-present control.

## 11. Resolved decisions

1. **Persistence consistency** — all six fields (including `one_shot`) share one
   `PATCH /schedule/entries/{id}` path; the dedicated one-shot route/method/client-method are
   removed. (§5, §6)
2. **Save behavior** — optimistic per-field commit (blur for text, change for the rest); no
   Save button. (§5)
3. **Floating-task time field** — disabled-with-hint, pending the deferred placement work. (§6)
