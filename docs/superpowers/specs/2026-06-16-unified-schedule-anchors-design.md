# Unified `/schedule/anchors` response — design

**Issue:** #958 — `fix(schedule): /schedule/anchors must return all anchor sources, not only meal anchors`
**Date:** 2026-06-16
**Architecture references:** §4.3 (daily rhythm / midnight-crossing), §4.7 (anchors), §4.8 (time & timezone resolution), §4.9 (slots)

## Problem

`GET /schedule/anchors` returns only materialized **meal** anchor instances
(`plnd_api/src/routes/schedule_anchors.rs::list_for_date` →
`Vec<MealAnchorInstanceResponse>`). Per §4.7 an anchor comes from four sources:

1. every materialized meal anchor instance (§4.6),
2. every scheduled task (a `schedule_entries` row with a `scheduled_start`),
3. the implicit start-of-day / end-of-day anchors (the active day type's
   `wake_time` / `sleep_time`, §4.3), and
4. timezone-change anchors (§4.8).

Three of the four are invisible at this endpoint today, so no consumer can build
the day's slot structure (§4.9 — slots are the gaps between adjacent anchors).

## Goal

Return a **unified, ordered anchor sequence** spanning all four sources, with
enough per-anchor information for a consumer to (a) render the anchor as a slot
boundary and (b) place floating tasks into the slot after their lower anchor.
Lazy materialization of meal instances is preserved.

This is a foundational contract fix. The actual day-view slot rendering is
**#959** (which develops in parallel against this contract). The only frontend
change here is the minimum needed to keep the existing day-view compiling and
`just verify` green.

## Decisions

### D1 — Response shape: flat struct with a `kind` discriminator

A single `ScheduleAnchorResponse` with always-present common fields plus
optional kind-specific fields. Chosen over a serde tagged enum (which produces a
`oneOf` in OpenAPI and a discriminated union in TS — more friction for every
consumer) and over an opaque `meta: JSON` envelope (weakly typed, defeats
contract pinning). The flat shape matches the existing `api_response.rs`
convention and lets meal-kind anchors carry every field the current frontend
mapper reads.

### D2 — Ordering: minutes-since-wake projection; `sequence` is the primitive

Each anchor resolves to a representative wall-clock `NaiveTime`. Project onto a
minutes-since-wake axis — `offset(t) = (t − wake_time).rem_euclid(24h)` — sort
ascending, and assign a 0-based `sequence`. Start-of-day is pinned first,
end-of-day pinned last. Ties break by `(kind, sort_order, id)` for determinism.

`sequence` — not `time` — is the structural primitive consumers use for slot
adjacency (§4.8: order, not clock value). `time` is informational. Clock-based
projection is used because there is **no stored cross-source ordering**; it
linearizes wake→sleep correctly for midnight-crossing day types (§4.3). See
Limitations for the tz-reordering caveat.

### D3 — Timezone anchors fold into the sequence (in-day boundaries only)

A timezone anchor becomes a `timezone_change` anchor **iff
`effective_date == date && effective_time.is_some()`** — i.e. it produces a
genuine mid-day boundary. Whole-day tz changes (`effective_time = None`) and
changes effective on an earlier date set the day's *starting* zone but do not
subdivide the day, so they are excluded from the sequence.

The existing `/timezone/anchors` (+ `TimezoneService.listAnchors` / `classifyDay`)
surface is unchanged and remains the cross-day **zone-resolution** dataset. The
two surfaces are complementary and documented as such:

- `/schedule/anchors` — the day's ordered structural sequence for slot rendering.
- `/timezone/anchors` — the multi-day zone-resolution dataset (`zone_at`).

### D4 — Start/end-of-day from the active day type

SOD: `time = wake_time`, `label = "start of day"`, pinned first.
EOD: `time = sleep_time`, `label = "end of day"`, pinned last (may resolve to the
following calendar date for midnight-crossing day types — handled by the
projection, since EOD is force-pinned last regardless of clock value).

The active day type is resolved exactly as meal materialization does it: list the
user's day types, sort by `created_at` descending, take the first matching
`day_type_applies_to(dt, date)`. If no day type resolves (should not happen given
the default-day-type invariant, §4.3), SOD/EOD are omitted and only data anchors
are returned — a degraded-but-valid result.

### D5 — Assembly in a pure `plnd_api` module; no `plnd_data` change

The ordering/assembly logic lives in a new pure, DB-free function
`assemble_day_anchors(...)` in `plnd_api/src/anchors.rs`. The route fetches inputs
through **existing** repository methods and calls it. No new SQL and no
`plnd_data` change — storage isolation is preserved (the route composes existing
repositories; the model helper `day_type_applies_to` is already public). The pure
function is what the midnight-crossing unit tests exercise.

## Response contract

`GET /schedule/anchors?date=YYYY-MM-DD` → `200 application/json`,
`Vec<ScheduleAnchorResponse>` ordered ascending by `sequence`.

```jsonc
{
  "kind": "meal",              // meal | scheduled_task | start_of_day | end_of_day | timezone_change (snake_case)
  "sequence": 2,               // i32, 0-based position in the ordered sequence (the §4.8 primitive)
  "time": "12:00:00",          // NaiveTime — resolved wall-clock time-of-day (informational)
  "label": "Lunch",            // stable name; matches the after_anchor convention ("start of day", "end of day", meal/task name)
  "id": "…uuid…",              // meal_anchor_instances.id or schedule_entries.entry_id; null for start_of_day / end_of_day

  // kind-specific — null unless applicable
  "status": "planned",         // meal only: planned | consumed | skipped
  "consumed_at": null,         // meal only
  "tolerance_minutes": 60,     // meal only
  "sort_order": 1,             // meal only
  "template_entry_id": "…",    // meal only
  "zone": null                 // timezone_change only: IANA name (e.g. "America/Denver")
}
```

- `kind` serializes snake_case (matching `TimezoneSource` / `DeviceAffirmOutcome`).
- Meal-kind anchors carry every field currently on `MealAnchorInstanceDto`, so the
  frontend `kind === 'meal'` path maps them unchanged.
- New types `ScheduleAnchorResponse` and `ScheduleAnchorKind` are defined in
  `plnd_api/src/api_response.rs` with `utoipa::ToSchema`. `MealAnchorInstanceResponse`
  remains (still returned by create / update / delete / set_status).
- The `#[utoipa::path]` annotation on `list_for_date` is updated: `body =
  Vec<ScheduleAnchorResponse>` and a refreshed description.

## Data flow (route)

`list_for_date`:

1. `meals = repos.meal_anchor_instance.materialize(user_id, date)` — preserves lazy materialization.
2. `entries = repos.schedule.get_day_entries(user_id, date)`; keep those with `scheduled_start.is_some()`.
3. `day_types = repos.day_type.list_for_user(user_id)`; sort by `created_at` desc; `active = first matching day_type_applies_to(dt, date)`.
4. `tz = repos.timezone_anchor.list_through(user_id, date)`.
5. `assemble_day_anchors(meals, scheduled_entries, active, tz, date)` → ordered `Vec<ScheduleAnchorResponse>`.

Error mapping mirrors the current handler (`ConnectionLost` → 503, else 500;
unauthorized on bad subject).

## `assemble_day_anchors` (pure)

Signature (sketch):

```rust
pub fn assemble_day_anchors(
    meals: Vec<MealAnchorInstance>,
    scheduled_tasks: Vec<ScheduleEntry>,   // pre-filtered: scheduled_start.is_some()
    active_day_type: Option<DayType>,
    tz_anchors: Vec<TimezoneAnchor>,
    date: NaiveDate,
) -> Vec<ScheduleAnchorResponse>
```

Algorithm:

1. Build intermediate anchors `{ kind, time, label, id, <kind fields>, pin }` where
   `pin ∈ { First, None, Last }`:
   - SOD (if `active_day_type`): `time = wake_time`, `pin = First`.
   - meals: `time = preferred_time`, carry status/tolerance/sort_order/template_entry_id/consumed_at.
   - scheduled tasks: `time = scheduled_start`, `label = title|"(untitled)"`, `id = entry_id`.
   - tz (in-day only, D3): `time = effective_time`, `label` = the IANA zone name (same value as `zone`, e.g. `"America/Denver"`), `zone = Some(iana)`, `id = anchor id`.
   - EOD (if `active_day_type`): `time = sleep_time`, `pin = Last`.
2. Sort: `First` anchors first, then by `offset(time) = (time − wake_time).rem_euclid(24h)`,
   then `(kind, sort_order, id)`; `Last` anchors last. When no active day type, there
   is no wake reference — fall back to raw `time` ordering for the data anchors only.
3. Assign `sequence = 0..n` over the sorted list. Map to `ScheduleAnchorResponse`.

## Frontend (minimal — keep verify green; real work is #959)

- Add a unified `ScheduleAnchorDto` to `plnd_client/src/app/core/models/week-plan.ts`
  (mirrors the contract above; fields optional where kind-specific).
- `schedule.service.ts:45` types the GET as `ScheduleAnchorDto[]`.
- In the subscribe handler, `const meals = anchors.filter(a => a.kind === 'meal')`
  and feed `meals` into the existing `mapAnchorInstance` path. The day-view renders
  byte-for-byte as today; no template/visual change.
- `schedule.service.spec.ts` updated for the unified DTO and the `kind === 'meal'` filter.

## Testing

**Rust unit (`anchors.rs`, no DB):**
- each source produces its anchor with correct field mapping;
- ordering for a normal day (wake < sleep);
- ordering for a **midnight-crossing day type** (e.g. wake 20:00, sleep 12:00; meals at 21:00 / 01:00 / 08:00 land in linear wake→sleep order, §4.3);
- tz in-day rule: included (effective today + time) vs excluded (whole-day, or earlier effective_date);
- empty-meals day still yields SOD + EOD (one slot);
- no active day type → only data anchors, no SOD/EOD;
- tie-break determinism (two anchors at the same minute).

**Rust integration (`plnd_api/tests/schedule_anchors_test.rs`):**
- authenticated `GET /schedule/anchors` against a seeded user returns all four kinds in one ordered sequence;
- first call still lazily materializes meal instances.

**Angular unit:** `schedule.service` spec for the unified DTO + `kind === 'meal'` filter.

**Pre-PR:** `just fmt`, then `just verify`.

## Limitations (documented)

- **Tz-induced reordering across a mid-day zone change** is not fully resolved: the
  projection compares wall-clock-within-effective-zone because no stored cross-source
  order exists. This is correct for midnight-crossing *day types* (the acceptance
  case) and for typical single-zone days; pathological same-day travel that reorders
  anchors across the tz boundary is a known edge. Downstream consumers rely on the
  emitted `sequence`, which is stable once assigned.
- **No `slot_end_anchor_id`** is introduced — slot upper bounds are derived from
  `sequence` adjacency (§4.9), consistent with the architecture.

## Out of scope (owned by #959)

- Day-view slot rendering, floating-task interleaving into slots, rendering SOD/EOD
  rows, scheduled-tasks-as-boundaries in the UI, and the floating-task e2e.

## Acceptance (from #958)

- Endpoint returns all four anchor sources as one ordered sequence; meal-only behavior is gone. ✔ (contract above)
- Unified anchor response type defined; OpenAPI/utoipa annotation updated. ✔ (`ScheduleAnchorResponse`, D1)
- Unit + integration tests cover each source and ordering, including a midnight-crossing day type. ✔ (Testing)
