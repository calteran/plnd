# Day-view slot/anchor sequence — design (#959)

> Point-in-time design artifact. The controlling reference is
> [docs/architecture.md](../../architecture.md) §4.7–4.9. Where this doc and the
> architecture diverge, the architecture wins.

## Problem

The day view does not render the slot/anchor sequence the model requires (§4.9: a
slot is the space between two adjacent anchors; floating tasks live in the slot
*after* their lower anchor). Today `ScheduleService` renders every meal anchor
first, then dumps all remaining entries — floating *and* scheduled — into one
`topLevel` list below the meals. Consequences:

- Floating tasks are not interleaved into their slots; their `after_anchor` is
  ignored for placement.
- The start-of-day slot ("before the first meal") has no correct home.
- Scheduled tasks are not treated as slot boundaries, even though §4.7 says a task
  with a fixed start time *is* an anchor.

A correct-shaped version of this logic already exists for onboarding in
`task-placement-review-substep` (`bucketOf` / `buildDayCards`); the day view never
got the equivalent.

This work also moves timezone-at-start-of-day determination from the client to the
server (see §B), because the same `/schedule/anchors` payload that drives slots
already carries the day's in-day `timezone_change` anchors.

## Invariant (anchors task placement)

Every task **either has an anchor or is an anchor**. There is no third category and
no fallback bucket:

| Entry shape                    | Render path                                              |
| ------------------------------ | -------------------------------------------------------- |
| `slot_meal_anchor_id` set      | Nests inside its meal row (`duringMealTasks`). Unchanged. |
| `scheduled_start` set          | The task *is* a `scheduled_task` anchor → its own row.    |
| `after_anchor` set (no time)   | Floating → renders in the slot *after* its matched anchor.|

An `after_anchor` that resolves to no anchor on a given day is an integrity
violation, not a layout case: the task is rendered defensively (logged, never
dropped), not given a designed fallback slot.

## A. Slot assembly (frontend, `ScheduleService`)

### Input
- `GET /schedule/anchors?date=<date>` — **all** anchor kinds (#958), pre-sorted by
  `sequence` and already linearized across midnight-crossing day types. The
  frontend never re-sorts.
- `GET /schedule/period?start=<date>&end=<date>` — `entries` (tasks) and
  `planned_meals`.

### Key facts (verified in code)
- A `scheduled_task` anchor's `id` **is** the entry's `entry_id`
  (`plnd_api/src/anchors.rs`), so a fixed task is deduped between the two payloads
  by `entry.entry_id === anchor.id`.
- `meal` anchor `id` is the meal-anchor-instance id, matching
  `entry.slot_meal_anchor_id` and `planned_meal.meal_anchor_instance_id`.
- `start_of_day` / `end_of_day` carry `id: null` and labels `"start of day"` /
  `"end of day"`.

### Algorithm
Extract a **pure, exported** function:

```
assembleScheduleItems(anchors, entries, plannedMeals) -> ScheduleItem[]
```

1. Partition `entries`:
   - `duringMeal`: `slot_meal_anchor_id` matches a meal anchor id → grouped by
     anchor id (unchanged behavior).
   - `scheduled`: has `scheduled_start` → indexed by `entry_id`.
   - `floating`: the rest (has `after_anchor`) → grouped by `after_anchor`
     lowercased.
2. Walk `anchors` in `sequence` order. For each anchor, in order:
   - `meal` → emit a `MealAnchor` with its grouped `duringMealTasks`.
   - `scheduled_task` → emit a `ScheduleTask` mapped from the entry found by
     `entry_id === anchor.id` (rich fields: type/energy/duration). The anchor
     supplies only ordering.
   - `start_of_day` / `end_of_day` / `timezone_change` → emit **no row**. They bound
     the sequence (so the first/last slots are well-defined); `timezone_change` is
     already rendered by the existing switch row.
   - After emitting the anchor's row(s), append the floating tasks whose
     `after_anchor` matches this anchor's `label` (case-insensitive). Tasks
     anchored to `"start of day"` therefore appear directly after the SOD boundary,
     i.e. at the top of the list.
3. Defensive tail: any floating task whose `after_anchor` matched no anchor is
   logged (`console.warn`) and appended at the top (treated as start-of-day),
   never dropped.

### Output & UI
The result is still a flat `ScheduleItem[]` (`MealAnchor | ScheduleTask`). The
day-view template and the `meal-row` / `task-row` components are **unchanged** — the
only behavioral change is item *order* and the interleaving of floating tasks. No
visible start/end-of-day divider rows are introduced (acceptance criterion #2 of
the issue, read literally as "visible rows," is in error; SOD/EOD remain invisible
placement boundaries).

## B. Server-side day-zone-view (backend + frontend)

Today the day view fetches the *entire* anchor history (`tz.listAnchors`) and
computes the start-of-day zone client-side (`zone-projection.ts` →
`incomingZoneAt`). That burden moves to the server.

### Endpoint
Extend `GET /timezone/resolve` to take the client's device zone and return the full
day view:

```
GET /timezone/resolve?at=<date>&device=<IANA>
->
{
  "zone": "<IANA|null>",                 // unchanged: zone at the requested point
  "day_view": {
    "kind": "same" | "divergent" | "travel",
    "incoming_zone": "<IANA|null>",      // zone at start of the day
    "current_zone": "<IANA>",            // the device zone passed in
    "switch": { "from_zone": "<IANA>", "to_zone": "<IANA>", "anchor_id": "<uuid>" }
                                          // present iff kind == "travel"
  }
}
```

- The server already has `zone_at` (incoming zone) and the day's in-day
  `timezone_change` anchors (intra-day switch). The **device zone** is the one input
  only the client holds, so it is passed in; with no `device` param the response
  omits `day_view` and behaves exactly as today (backward compatible).
- `resolve_zone` fetches only what it needs (most-recent anchor at/before
  start-of-day, plus that date's intra-day tz anchors), not the full history.

### Frontend
- Day view consumes `day_view` directly to build its `DayZoneView`.
- **Delete** `classifyDay` / `incomingZoneAt` from `zone-projection.ts`.
- `tz.listAnchors` stays, used **only** by the why-panel's delete/replace flow
  (`openWhyForGoverning`, `onUseCurrent`), which needs the rich `TimezoneAnchorDto`
  (`source`, `inference_group`, `effective_date`) the leaner anchor shapes lack.

## Testing

- **Unit (frontend):** `assembleScheduleItems` —
  - start-of-day slot (task above the first meal),
  - slot bounded by a scheduled task,
  - floating tasks across multiple slots,
  - during-meal nesting preserved,
  - scheduled task rendered once (no duplicate between anchors/entries),
  - midnight-crossing order respected (consumes pre-sorted sequence as-is),
  - unmatched floating task is rendered, not dropped.
- **Unit (backend):** `resolve_zone` `day_view` assembly — `same`, `divergent`,
  `travel` cases; `device` absent → `day_view` omitted.
- **E2E:** a day seeded (via real API helpers) with floating tasks in the
  start-of-day slot, between meals, and after a scheduled task; assert render order.

## Out of scope

- Visible start/end-of-day divider rows (issue criterion #2 read as "visible" — in
  error).
- Within-slot ordering of multiple floating tasks (§4.9: unordered until the user
  or LLM sequences them). Preserve input order.
- #922 / #923 (downstream consumers of real slots).
```
