# Task drag-reordering across the three task surfaces — design

> Point-in-time design artifact. The controlling reference is
> [docs/architecture.md](../../architecture.md) §4.6–4.9. Where this doc and the
> architecture diverge, the architecture wins.
>
> Builds on the slot/anchor assembly that shipped in #961 (`schedule-assembly.ts`
> `assembleScheduleItems`), which interleaves floating tasks into slots but
> preserves input order within a slot. This spec adds the missing user-sequencing
> (§4.9), plus moves between slots, into/out of meal pairings, and across days.

## Problem

A user cannot arrange their tasks. Architecture §4.9 says *"within a slot, tasks
have no inherent order until the user sequences them or the LLM proposes one"* — but
there is no persisted field for that sequence, and no UI to set it. Floating tasks
come back from the backend in effectively arbitrary order (they have
`scheduled_start = NULL`, which sorts last), and the two planning wizards hold tasks
only as array order that the commit round-trip discards.

The user wants to drag tasks into a preferred order in all three surfaces that show
a task layout:

1. **Day view** (`day-view`) — live, persisted schedule.
2. **Onboarding task-placement review** (`task-placement-review-substep`) — a
   pre-commit draft of agent-placed tasks.
3. **Weekly planning wizard day-grid review** (`plan-day-grid-step` /
   `plan-day-card`) — a pre-commit draft of the week's plan.

Within each, drag must support four gestures: reorder **within a slot**, move
**between slots**, move **into/out of a meal pairing**, and (in the two multi-day
wizard layouts) move **across days**.

## Scope and non-goals

In scope:

- A persisted within-slot ordering field and the integrity constraints that keep it
  honest.
- Drag-and-drop in all three surfaces, all four gestures.
- The backend operation the day view calls on each drop, and the commit-payload
  extensions the two wizards need.

Non-goals (v1):

- **No non-drag (keyboard/button) reorder path.** Pointer drag only. The
  accessibility gap is tracked by a follow-up GitHub issue (see *Follow-up*), per
  the project rule that a known limitation gets a tracking issue.
- **No dragging of anchors.** Meals reorder by editing `preferred_time` (§4.6);
  scheduled tasks *are* anchors positioned by their clock time (§4.7). Drag never
  moves a meal row or a scheduled-task row — only the floating/paired tasks that
  live in slots.
- No change to how slots/anchors are computed (`assembleScheduleItems` already does
  that).

## The invariant (already enforced by `assembleScheduleItems`)

Every task **either has an anchor or is an anchor** — this design only orders the
tasks that *have* one:

| Entry shape                  | Slot identity                              | Draggable? |
| ---------------------------- | ------------------------------------------ | ---------- |
| `slot_meal_anchor_id` set    | paired — "slot" is the meal instance       | yes        |
| `after_anchor` set (no time) | floating — slot is the anchor it follows   | yes        |
| `scheduled_start` set        | the task *is* a `scheduled_task` anchor    | no         |

A draggable task's full placement is `(date, slot key, slot_position)`, where the
**slot key** is `after_anchor` *or* `slot_meal_anchor_id` (mutually exclusive,
never both). `slot_position` orders tasks within that group.

## A. Data model (`plnd_data`)

### Migration

Add to `schedule_entries` (next free migration number — verify no collision against
`origin/main` before pushing, per the rebase rule):

```sql
ALTER TABLE schedule_entries
  ADD COLUMN slot_position INT NOT NULL DEFAULT 0;

ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_slot_after_anchor_position_key
    UNIQUE (user_id, date, after_anchor, slot_position)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_slot_meal_anchor_position_key
    UNIQUE (user_id, date, slot_meal_anchor_id, slot_position)
    DEFERRABLE INITIALLY DEFERRED;
```

Why this shape:

- **Two constraints, not one.** The slot key is polymorphic (`after_anchor` text
  *or* `slot_meal_anchor_id` uuid), so there is no single column to constrain.
- **NULLs-distinct does the partitioning for free.** A floating task has NULL
  `slot_meal_anchor_id`, so it is invisible to the meal constraint; a paired task
  has NULL `after_anchor`, so it is invisible to the slot constraint; a
  scheduled-task anchor has both NULL and is constrained by neither (correct — it
  doesn't live in a slot). No `WHERE` filter is needed.
- **`DEFERRABLE INITIALLY DEFERRED`** so the renumber transaction (below) can pass
  through transient collisions (`0,1,2 → 1,2,3`) and is validated only at COMMIT.
  Partial unique *indexes* can't be deferred — which is the second reason to lean on
  NULL-distinct constraints rather than `WHERE` indexes.

Forward-only: no backfill (the dev DB is wiped each build; `DEFAULT 0` covers any
pre-existing rows). Touch a `plnd_data` source file in the same change so the new
migration is re-embedded into the test/API binaries.

### Model

`ScheduleEntry` (`plnd_data/src/models/schedule.rs`) gains `pub slot_position: i32`.
Add the column to `ENTRY_COLS` and to the period/day-entry projections so it is read
back.

## B. Backend read ordering (`plnd_data`)

`get_period` and `get_day_entries` change their `ORDER BY` to:

```
ORDER BY date, slot_position, scheduled_start, entry_id
```

`assembleScheduleItems` already buckets entries by slot key, so within each bucket
tasks now emerge in `slot_position` order. Scheduled-task anchors are matched by id
and unaffected by the new sort term.

## C. Backend reposition operation (`plnd_data` + `plnd_api`)

The day view persists each drop with one idempotent call.

### Endpoint

```
PATCH /schedule/entries/{id}/position
body: {
  "date": "YYYY-MM-DD",
  "after_anchor": "lunch" | null,            // exactly one of these two…
  "slot_meal_anchor_id": "<uuid>" | null,    // …is non-null
  "position": <int>                          // 0-based index in the target slot
}
```

Validation: exactly one slot key non-null (400 otherwise); entry owned by the caller
(404 otherwise); a non-null `slot_meal_anchor_id` must reference a meal anchor
instance for that user/date.

### Repository method

`ScheduleRepository::reposition_entry(user_id, entry_id, target: SlotTarget, position)`
where `SlotTarget` is an enum `{ AfterAnchor(String), MealAnchor(Uuid) }` carrying
the resolved `date`. Runs in **one transaction**:

1. Read the entry's current slot (source).
2. Set the entry's `date`, slot key (the other slot-key column to NULL), and
   `scheduled_start = NULL` (the floating contract — a dragged task is never
   fixed-time).
3. **Target slot:** shift siblings at `>= position` up by one, set the entry's
   `slot_position = position`.
4. **Source slot** (if different from target — a cross-slot/cross-meal/cross-day
   move): compact the gap left behind so the source stays `0..n` contiguous.

Both slots are renumbered inside the single transaction; the deferred constraints
validate the final state at COMMIT.

`EntryPatch` / the generic `PATCH /schedule/entries/{id}` are **not** extended —
reposition is its own operation so the four gestures funnel through one code path.

## D. Backend commit path (the two wizards)

`PlanEntryRequest` (`plnd_api` request model + its `plnd_data` commit input) gains:

- `slot_position: Option<i32>` — derived by the client from array order per
  `(date, slot)`.
- `paired_meal_name: Option<String>` — see the wrinkle below.

`after_anchor` already flows through commit. `commit_plan` persists `slot_position`
verbatim and resolves `paired_meal_name`.

### The pre-commit meal-pairing wrinkle

In the wizards, meal anchor **instances do not exist yet** — onboarding shows
label-only meal dividers, and the weekly grid keys meals by slot/name. So a task
dragged *into a meal* in a wizard cannot carry a `slot_meal_anchor_id`. It carries
`paired_meal_name` (the meal's name/label) instead. During `commit_plan`, after the
date's meal anchor instances are materialized from `meal_entries`, the backend
resolves each `paired_meal_name` to the matching instance's id for that `(date,
name)` and writes it to `slot_meal_anchor_id`. If no instance matches, the task
falls back to floating in the corresponding `after_anchor` slot (logged, never
dropped — consistent with the defensive posture already in `assembleScheduleItems`).

The day view, which operates on materialized instances, always uses
`slot_meal_anchor_id` directly and never needs `paired_meal_name`.

## E. Frontend — assembly produces droppable slot groups

The shipped `assembleScheduleItems` returns a flat `ScheduleItem[]` because order
was the only concern. Drag needs each slot to be its own drop container, so assembly
now emits an explicit grouped structure:

```
SlotGroup {
  anchor: MealAnchor | ScheduledTaskRow | StartOfDay;  // the lower boundary
  slotKey: { afterAnchor: string } | { mealAnchorId: string };
  tasks: ScheduleTask[];   // ordered by slot_position
}
```

The day-view template renders one `cdkDropList` per `SlotGroup.tasks`, plus one per
meal's `duringMealTasks`. `meal-row` / `task-row` themselves are unchanged; only the
day-view container template and the assembly return type change. The existing
`assembleScheduleItems` unit tests are updated to assert the grouped shape and
`slot_position` order rather than the flat order.

## F. Frontend — drag wiring (Angular CDK)

Add `@angular/cdk` (not currently a dependency) and use `DragDropModule`
(`cdkDropList`, `cdkDrag`, `moveItemInArray`, `transferArrayItem`). The three
surfaces share the gesture vocabulary but not a list component; each wires its own
connected drop lists.

### Day view (live — Phase 2)

- Every slot list and every meal during-meal list is a connected `cdkDropList`;
  connecting them lets a task move between slots and into/out of a meal.
- On `cdkDropListDropped`: optimistically apply the move to local signal state,
  derive `(date, slot key, position)` for the target, call
  `PATCH /schedule/entries/{id}/position`; on failure revert the optimistic change
  and surface a toast.

### Onboarding placement review + weekly day-grid (drafts — Phase 3)

- Both already hold tasks as ordered signal arrays
  (`PlaceTasksEntry[]` / `WeekPlanService.scheduledTasks`). Drag reorders the array;
  **cross-day** uses `transferArrayItem` between day-card lists, which rewrites the
  task's `date`. Into/out of a meal moves the task between a slot list and a meal's
  pairing list, setting/clearing `paired_meal_name` locally.
- Nothing hits the backend until commit. At commit, each `(date, slot)` group's
  array index becomes `slot_position`; paired tasks send `paired_meal_name`. This
  requires threading `slot_position` / `paired_meal_name` (and the existing
  `after_anchor`) through `PlanEntryRequest` for both the onboarding
  (`placed_tasks`) and weekly (`entries`) commit arrays.

## G. Error handling

- **Day view:** optimistic-with-rollback on the reposition call. A failed call never
  leaves the UI out of sync with the server.
- **Wizards:** pure local state until commit; the deferred DB constraints turn any
  position-collision bug into a hard COMMIT failure (surfaced as a commit error)
  rather than silent corruption.
- **Reposition endpoint:** 400 on zero/both slot keys, 404 on a foreign entry, 422
  on a `slot_meal_anchor_id` that isn't an instance for that user/date.

## H. Testing

Per the project's mock policy, schedule endpoints are served by the real backend in
e2e; only agent endpoints are mocked. So reposition/commit logic is covered by Rust
integration tests, and the drag UX by Playwright against the real backend.

- **Rust integration (`reposition_entry`):** within-slot reorder; move between two
  `after_anchor` slots (source compacts, target inserts); into a meal pairing
  (`after_anchor` → `slot_meal_anchor_id`); out of a meal pairing; cross-day move;
  deferred-constraint renumber passing a transient collision; ownership 404; foreign
  meal-anchor 422.
- **Rust integration (`commit_plan`):** `slot_position` persisted from the payload;
  `paired_meal_name` resolved to the materialized instance; unmatched
  `paired_meal_name` falls back to floating.
- **Angular unit:** `assembleScheduleItems` grouped shape + `slot_position` order;
  each surface's drop handler updates state correctly (dispatch real CDK drop
  events, not direct field writes — OnPush).
- **E2E (Playwright):** in each of the three surfaces — drag within a slot, between
  slots, into a meal, out of a meal; cross-day in the two wizards; for the day view,
  assert the order survives a reload (proves persistence).

## I. Phasing (one spec, phased plan)

1. **Backend foundation** — migration + constraints, `slot_position` on the model,
   read ordering, `reposition_entry` + endpoint, `PlanEntryRequest` extension +
   `commit_plan` resolution. Lands with Rust integration tests.
2. **Day view drag** — assembly → slot groups, CDK wiring, reposition calls,
   optimistic rollback. Frontend unit + e2e.
3. **Wizard drag** — onboarding + weekly day-grid CDK wiring, cross-day transfer,
   commit-payload derivation. Frontend unit + e2e.

Each phase is its own PR against `main`; the feature is cohesive under the §4.10
capability-parity rule (day view and planning wizard must support the same actions).

## Follow-up

Open a GitHub issue for a **non-drag (keyboard/button) reorder path** before this
work merges — v1 is drag-only and that is a real accessibility gap for a
neurodivergent-focused planner with a dedicated accessibility onboarding spoke.

## Open integrity note

`slot_position` uniqueness is enforced per `(user_id, date, slot key)` by the two
deferred constraints. Application code (reposition + commit) is responsible for
producing contiguous `0..n` values; the constraints catch gaps-as-duplicates only,
not gaps themselves. Contiguity is a soft invariant (a gap is harmless to ordering)
and is asserted in tests rather than enforced in the schema.
