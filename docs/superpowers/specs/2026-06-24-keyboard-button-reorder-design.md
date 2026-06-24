# Keyboard/button reorder path for tasks — design

> Point-in-time design artifact. The controlling reference is
> [docs/architecture.md](../../architecture.md) §4.6–4.10. Where this doc and the
> architecture diverge, the architecture wins.
>
> Follow-up to the drag-reordering work
> ([docs/superpowers/specs/2026-06-22-task-drag-reordering-design.md](2026-06-22-task-drag-reordering-design.md)),
> which shipped pointer-drag only across the day view and both planning wizards and
> deferred the non-drag path to GitHub issue #986. This spec adds that path.

## Problem

Reordering a task today requires a pointer drag. That excludes keyboard-only users
and pointer users with motor difficulty, and it is a real accessibility gap for a
neurodivergent-focused planner that has a dedicated accessibility onboarding spoke.
The drag spec recorded this as an explicit v1 non-goal ("No non-drag
(keyboard/button) reorder path") and opened #986 to close it.

The non-drag path must cover the **same four gestures** drag covers, across the same
three surfaces:

1. **Day view** (`day-view`) — live, persisted schedule.
2. **Onboarding task-placement review** (`task-placement-review-substep`) — a
   pre-commit draft of agent-placed tasks.
3. **Weekly planning wizard day-grid review** (`plan-day-grid-step` /
   `plan-day-card`) — a pre-commit draft of the week's plan.

The four gestures: reorder **within a slot**, move **between slots**, move
**into/out of a meal pairing**, and (in the two multi-day wizards) move **across
days**.

## The core idea

Every gesture except cross-day reduces to **"move the task one position earlier or
later in the visual reading order of its day."** Crossing a slot edge *is* a
between-slots move; crossing a meal divider *is* an into/out-of-pairing move. So two
controls — `↑` (earlier) and `↓` (later) — cover three of the four gestures, with
the boundary crossing happening implicitly and announced to assistive tech.

Cross-day is the fourth gesture and the only one the up/down model handles poorly
(reaching another day from the top of a long day means stepping through every task).
It gets its own pair of controls — `«` (previous day) and `»` (next day) — in the
two wizards. Keeping `↑`/`↓` **day-bounded** means there is exactly one way to change
days; `↓` at the bottom of a day stops rather than spilling into tomorrow.

| Surface     | Controls            | Gestures covered                                   |
| ----------- | ------------------- | -------------------------------------------------- |
| Day view    | `↑` `↓`             | within-slot, between-slots, into/out-of-meal       |
| Onboarding  | `↑` `↓` `«` `»`     | all four (cross-day via `«`/`»`)                   |
| Weekly grid | `↑` `↓` `«` `»`     | all four (cross-day via `«`/`»`)                   |

The day view is single-day, so it never shows `«`/`»`.

## Scope and non-goals

In scope:

- A reveal-on-focus reorder control hosted on every draggable task row in all three
  surfaces.
- Keyboard- and click-activated `↑`/`↓` reorder covering within-slot, between-slots,
  and into/out-of-meal in all three surfaces.
- `«`/`»` cross-day moves in the two wizards.
- Focus-follows-task and `aria-live` announcements for every move.

Non-goals (v1):

- **No grab-and-move mode.** No stateful "lifted" mode with arrow-key dragging and
  Escape-to-cancel. The controls are stateless buttons — the lower-cognitive-load
  choice for this app, and discoverable without a mode to remember. (The WAI-ARIA
  sortable grab pattern was considered and rejected for that reason.)
- **No persistent visible affordance.** Controls are hidden in the resting UI and
  revealed only when the task row has focus — no hover reveal, to keep the list calm
  as the pointer moves across it.
- **No anchor movement.** Meals and scheduled-task anchors do not reorder, matching
  the drag non-goals (§4.6–4.7). Only floating/paired tasks move.
- **No backend changes.** A keyboard move produces the identical
  `(slot key, position)` a drop produces, so it reuses the reposition endpoint
  (day view) and the commit payload (wizards) the drag work already shipped.
- **No arrow-key-on-row capture.** The buttons are the keyboard target (Tab to them,
  Enter/Space to activate). The day view does not trap `ArrowUp`/`ArrowDown` on the
  row itself, avoiding scroll-hijack and focus-trap complexity. The issue offers
  "buttons *or* arrow handling"; this design takes buttons.

## A. Shared unit — `ReorderControlsComponent` (`app-reorder-controls`)

Presentational only. Renders the reorder buttons and nothing else; holds no move
logic and knows nothing about slots, meals, or days.

### Inputs

- `label: string` — the task title, woven into each button's `aria-label`
  (e.g. *"Move Take meds earlier"*).
- `canUp: boolean`, `canDown: boolean` — enable/disable `↑`/`↓`.
- `canPrevDay?: boolean`, `canNextDay?: boolean` — enable/disable `«`/`»`. **When
  both are `undefined` the day-jump buttons are not rendered at all** (the day-view
  case); when provided (even as `false`) the buttons render, disabled as
  appropriate.
- `taskId: string` — used to build stable button element ids
  (`reorder-{taskId}-up` / `-down` / `-prevDay` / `-nextDay`) so the host can
  re-focus a specific button after a move.

### Outputs

`up`, `down`, `prevDay`, `nextDay` — bare `void` emitters. The host decides what a
move means.

### Reveal-on-focus

Buttons are always in the DOM (stable Tab order) but visually hidden until the host
row is `:focus-within`, revealed by CSS — e.g. the row container carries the control
and a `.task-row:focus-within app-reorder-controls { visibility: visible }` rule;
the resting state is `visibility: hidden`. Because the row's existing focusable
element (the task label, already `tabindex="0"` for the edit affordance) triggers
`:focus-within` the instant a keyboard user lands on the row, the buttons become
visible **and** focusable before the next Tab reaches them. `visibility: hidden`
(not `display: none`) keeps layout stable as focus moves.

Buttons are real `<button type="button">` elements, so they are keyboard-activable
(Enter/Space) and pointer-activable (click) with no custom key handling.

## B. Shared unit — `reorder-navigation.ts` (pure)

The only subtle logic in the feature is "given the day's layout and a task, where
does an earlier/later step land?" — including the slot- and meal-boundary crossings.
It lives in one pure, DOM-free, exhaustively unit-tested module.

### Normalized layout

Each surface maps its own assembly into a common single-day shape:

```
DaySlot {
  slotKey: string;        // after_anchor label, meal name/id, or '<sched>'
  kind: 'slot' | 'meal';  // meal = a during-meal pairing list
  taskIds: string[];      // ordered
}
DayLayout = DaySlot[];     // in visual reading order, top to bottom
```

### API

```
stepWithinDay(layout: DayLayout, taskId: string, dir: 'up' | 'down'):
  | { slotKey: string; index: number; crossing: Crossing }
  | null   // already at the day's first (up) / last (down) position

type Crossing = 'same-slot' | 'into-meal' | 'out-of-meal' | 'to-slot';
```

`stepWithinDay` finds the task's `(slot, index)`, computes the adjacent position in
the flattened reading order, and reports what boundary (if any) it crossed so the
host can compose the announcement. Returns `null` at the day edge → the host
disables that direction.

```
resolveDayJump(currentSlotKey: string, targetDaySlotKeys: string[]):
  string   // the slot key the task lands in on the target day
```

`resolveDayJump` returns `currentSlotKey` if the target day has that slot, otherwise
`'<sched>'` (unanchored fallback). The task appends to the **end** of the resolved
slot on the target day. (Cross-day is otherwise a date change + slot patch the
surfaces already perform for drag.)

Both functions are pure; the day-edge / boundary / fallback cases are the unit-test
matrix.

## C. Per-surface wiring

Each surface already owns its layout assembly and an existing move operation. The
wiring is glue: map assembly → `DayLayout`, call the helper, dispatch the result to
the existing operation, then manage focus and announcement.

### Day view (`day-view`)

- Host `app-reorder-controls` on each `app-task-row` (slot tasks and during-meal
  tasks). `canUp`/`canDown` come from `stepWithinDay(...) !== null` per direction; no
  day-jump inputs (single day).
- On `up`/`down`: optimistically reorder the local slot-map array (same maps the
  drag handler mutates), then call the **existing**
  `ScheduleService.repositionTask(id, date, target, position)` with the helper's
  `{ slotKey → target, index → position }`. Optimistic-with-rollback exactly mirrors
  `onSlotDrop`/`onMealDrop`: on success `loadDay` re-syncs; on error `loadDay` rolls
  back and a toast surfaces.
- `target` is `{ afterAnchor }` for a slot crossing and `{ mealAnchorId }` for an
  into/out-of-meal crossing — derived from the resolved `DaySlot.kind`/`slotKey`,
  the same mapping the two drop handlers already make.

### Onboarding placement review (`task-placement-review-substep`)

- Host the control on each task row (the `.task-row` inside `.task-drag-item`).
  Provide `canPrevDay`/`canNextDay` from the task's day position in the horizon.
- `up`/`down`: map `buildDaySections(...)` → `DayLayout`, call `stepWithinDay`,
  apply the result with the **existing** `entries` signal mutation pattern already in
  `onDrop` (atomic clear-both-slot-fields-then-set, splice into the target index).
- `prevDay`/`nextDay`: `resolveDayJump` against the target day's section slot keys,
  then the same `entries` mutation with the new `scheduled_date` and resolved slot.
- Order still flows to the backend only at commit via `toPlanEntries()`
  (`slot_position` derived from array order, `paired_meal_name` for paired tasks) —
  unchanged.

### Weekly day-grid (`plan-day-card`)

- Host the control on each `.draggable-task` row. Provide day-jump inputs from
  `horizonDays`.
- `up`/`down`: map this card's `tasksForSlot(...)` groups → `DayLayout`, call
  `stepWithinDay`, dispatch to the **existing** `WeekPlanService.reorderTask`
  (same-slot) or `updateTaskSlot` (cross-slot) with the resolved target/index.
- `prevDay`/`nextDay`: `resolveDayJump` against the target date's meal slots, then
  `WeekPlanService.updateTaskSlot(task, newDate, slotKey, endIndex)`.
- Commit derivation (`buildCommitRequest`) is unchanged.

## D. Accessibility — focus and announcements

This is the substance of the feature; the move itself is reused plumbing.

### Focus follows the task

After any move the row re-renders (`@for … track id`). In a queued microtask
(mirroring `DayViewComponent.closeEditor`'s focus restore) the host re-focuses the
**same** button that was activated, by its stable id
(`reorder-{taskId}-{dir}`). This makes repeated `↓ ↓ ↓` keep moving the one task.

Edge: if the activated button becomes **disabled** at a boundary (e.g. the task
reached the bottom, so `↓` is now disabled), focus moves to the still-enabled
sibling button; if neither remains (a one-task slot at the day edge), focus falls
back to the row's label. Day-jump buttons follow the same rule against the horizon
edges.

For the day view, focus restoration runs after the `repositionTask` success path's
`loadDay` rebuild resolves (the optimistic local move focuses immediately; the
post-reload rebuild re-focuses by id), so focus survives the async round-trip.

### Announcements

A single `aria-live="polite"` region per surface (a small shared announcer
component or service) speaks the outcome, composed from the helper's `Crossing`:

| Crossing      | Example announcement                  |
| ------------- | ------------------------------------- |
| `same-slot`   | "Moved up" / "Moved down"             |
| `to-slot`     | "Moved after Lunch"                   |
| `into-meal`   | "Moved into Breakfast"                |
| `out-of-meal` | "Moved out of Breakfast"              |
| day jump      | "Moved to Tuesday, after Breakfast" / "Moved to Tuesday, unanchored" |

Button `aria-label`s name the task and direction (*"Move Take meds earlier"*,
*"Move Take meds to the next day"*) so the control is self-describing even before a
move.

## E. Error handling

- **Day view:** optimistic-with-rollback on `repositionTask`, identical to the drag
  path — a failed call re-fetches authoritative state and toasts, never leaving the
  UI out of sync. Focus restoration tolerates the row being absent after a rollback
  (guarded `?.focus()`).
- **Wizards:** pure local signal state until commit; no call to fail mid-move. A
  position bug surfaces as a hard COMMIT failure via the deferred DB constraints
  (the drag spec's §G posture), not silent corruption.
- **Helper:** `null` from `stepWithinDay` is the normal day-edge signal (disables the
  direction), not an error.

## F. Testing

Per the project mock policy, schedule endpoints are served by the real backend in
e2e; only agent endpoints are mocked.

- **Unit (`reorder-navigation`, pure):** within-slot up/down; cross-slot (`to-slot`);
  into a meal (`into-meal`) and out of a meal (`out-of-meal`); day-edge `null` at top
  (up) and bottom (down); `resolveDayJump` same-key hit and `<sched>` fallback;
  single-task slot at a boundary.
- **Component (`ReorderControlsComponent`):** day-jump buttons absent when
  `canPrevDay`/`canNextDay` undefined and present (disabled) when provided; disabled
  state per `can*`; reveal-on-`:focus-within`; each button emits its output; stable
  element ids.
- **Per-surface unit (OnPush — dispatch real DOM `click` events, not method calls):**
  each surface's `up`/`down`/`prevDay`/`nextDay` produces the correct resulting order
  via its existing move op; focus lands on the re-rendered button; the announcer text
  matches the crossing. Day view also asserts `repositionTask` is called with the
  derived target/position and that an error path rolls back.
- **E2E (Playwright, keyboard-only, real backend):** in each surface — Tab to a task,
  reveal the controls, reorder within a slot, into a meal, between slots; in the two
  wizards, `«`/`»` cross-day; for the day view, assert the new order **survives a
  reload** (proves persistence); for the wizards, assert the committed schedule
  reflects the keyboard order. New e2e files end in `*.e2e.ts` and seed auth/data via
  the real API helpers.

## G. Phasing (one spec, two PRs — no backend leg)

1. **Phase 1 — shared primitives + day view.** `ReorderControlsComponent`,
   `reorder-navigation.ts`, the announcer, and the day-view wiring (the simplest
   single-day case, and the only one that exercises persistence). Lands with the pure
   helper's unit tests, component tests, day-view unit tests, and day-view e2e.
2. **Phase 2 — the two wizards.** Onboarding placement review and weekly day-grid
   wiring, including `«`/`»` cross-day and `resolveDayJump`. Reuses the Phase 1
   primitives. Lands with each wizard's unit tests and keyboard e2e.

Each phase is its own PR against `main`. The feature is cohesive under the §4.10
capability-parity rule: the day view and the planning wizards must support the same
actions, and keyboard reordering is now one of them.
