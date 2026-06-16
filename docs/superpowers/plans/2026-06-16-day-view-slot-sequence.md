# Day-view slot/anchor sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the day view as an ordered anchor sequence with floating tasks placed in their slots, and move start-of-day timezone determination to the server.

**Architecture:** A new pure frontend function `assembleScheduleItems` walks the full `/schedule/anchors` sequence (all kinds), nests during-meal tasks in meal rows, emits scheduled tasks as their own rows, and interleaves floating tasks into the slot after their matched anchor. A new pure backend function `day_zone_view` computes the day's zone view (same/divergent/travel) so the client can retire `classifyDay`/`incomingZoneAt`; `GET /timezone/resolve` is extended with an optional `device` param to return it.

**Tech Stack:** Rust/Axum + `plnd_data` (backend), Angular 21 signals + Jasmine/Karma (frontend), Playwright (e2e).

**Reference spec:** `docs/superpowers/specs/2026-06-16-day-view-slot-sequence-design.md`

**Worktree:** `/Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots` (branch `worktree-fix+959-day-view-slots`). Run all commands from here.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `plnd_client/src/app/core/utils/schedule-assembly.ts` | Pure slot-assembly: anchors + entries → ordered `ScheduleItem[]`; owns the API→model mappers moved out of the service. | Create |
| `plnd_client/src/app/core/utils/schedule-assembly.spec.ts` | Unit tests for `assembleScheduleItems`. | Create |
| `plnd_client/src/app/core/services/schedule.service.ts` | HTTP + signals + mutations; delegates assembly to `schedule-assembly.ts`. | Modify |
| `plnd_data/src/timezone/mod.rs` | Add pure `day_zone_view` + types, mirroring client `classifyDay`. | Modify |
| `plnd_api/src/routes/timezone.rs` | `resolve` accepts `device`, returns `day_view`. | Modify |
| `plnd_client/src/app/core/models/timezone.ts` | `ResolveResponse` gains optional `day_view`. | Modify |
| `plnd_client/src/app/core/services/timezone.service.ts` | `resolve(at, time?, device?)`. | Modify |
| `plnd_client/src/app/core/utils/zone-projection.ts` | Keep `DayZoneView`/`DaySwitch` types; remove `classifyDay`/`incomingZoneAt`/`ordered`. | Modify |
| `plnd_client/src/app/core/utils/zone-projection.spec.ts` | Tests for removed `classifyDay`. | Delete |
| `plnd_client/src/app/features/day-view/day-view.ts` | Build `zoneView` from server `day_view`. | Modify |
| `plnd_client/src/app/features/day-view/day-view.spec.ts` | Update timezone-test mocks for `resolve` returning `day_view`. | Modify |
| `plnd_client/e2e/day-view-slots.spec.ts` | E2E: floating tasks across multiple slots. | Create |

---

## Task 1: Pure `assembleScheduleItems` (frontend slot assembly)

**Files:**
- Create: `plnd_client/src/app/core/utils/schedule-assembly.ts`
- Test: `plnd_client/src/app/core/utils/schedule-assembly.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `plnd_client/src/app/core/utils/schedule-assembly.spec.ts`:

```ts
import { assembleScheduleItems } from './schedule-assembly';
import { isMealAnchor, MealAnchor, ScheduleTask } from '../models/schedule';
import { ScheduleAnchorDto, ScheduleAnchorKind, ScheduleEntryDto } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';

let seq = 0;
function anchor(kind: ScheduleAnchorKind, label: string, id: string | null): ScheduleAnchorDto {
  return {
    kind, sequence: seq++, time: '08:00:00', label, id,
    status: kind === 'meal' ? 'planned' : null, consumed_at: null,
    tolerance_minutes: null, sort_order: null, template_entry_id: null, zone: null,
  };
}
function entry(p: Partial<ScheduleEntryDto> & { entry_id: string }): ScheduleEntryDto {
  return {
    task_type: 'general', title: 'Task', date: '2026-06-16', status: 'pending', ...p,
  } as ScheduleEntryDto;
}

beforeEach(() => { seq = 0; });

describe('assembleScheduleItems', () => {
  it('places a floating task in the start-of-day slot (above the first meal)', () => {
    const anchors = [
      anchor('start_of_day', 'start of day', null),
      anchor('meal', 'Breakfast', 'meal-1'),
      anchor('end_of_day', 'end of day', null),
    ];
    const entries = [entry({ entry_id: 't1', title: 'Meds', after_anchor: 'start of day' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.map(i => isMealAnchor(i) ? `meal:${i.name}` : `task:${i.label}`))
      .toEqual(['task:Meds', 'meal:Breakfast']);
  });

  it('renders a scheduled task once, as its own row at its sequence position', () => {
    const anchors = [
      anchor('meal', 'Breakfast', 'meal-1'),
      anchor('scheduled_task', 'Standup', 'sched-1'),
    ];
    const entries = [entry({ entry_id: 'sched-1', title: 'Standup', scheduled_start: '09:00' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(2);
    const task = items[1] as ScheduleTask;
    expect(task.label).toBe('Standup');
    expect(task.scheduledStart).toBe('09:00');
    expect(task.floating).toBeFalse();
  });

  it('interleaves a floating task into the slot after a scheduled-task anchor', () => {
    const anchors = [
      anchor('scheduled_task', 'Standup', 'sched-1'),
      anchor('meal', 'Lunch', 'meal-2'),
    ];
    const entries = [
      entry({ entry_id: 'sched-1', title: 'Standup', scheduled_start: '09:00' }),
      entry({ entry_id: 't2', title: 'Email', after_anchor: 'Standup' }),
    ];
    const labels = assembleScheduleItems(anchors, entries, [])
      .map(i => isMealAnchor(i) ? `meal:${i.name}` : `task:${(i as ScheduleTask).label}`);
    expect(labels).toEqual(['task:Standup', 'task:Email', 'meal:Lunch']);
  });

  it('nests during-meal tasks inside their meal row (slot_meal_anchor_id)', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const entries = [entry({ entry_id: 't3', title: 'Vitamins', slot_meal_anchor_id: 'meal-1' })];
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(1);
    const meal = items[0] as MealAnchor;
    expect(meal.duringMealTasks.map(t => t.label)).toEqual(['Vitamins']);
  });

  it('binds a planned meal title to its meal anchor', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const planned: PlannedMealEntryDto[] = [
      { meal_anchor_instance_id: 'meal-1', title: 'Avocado toast' } as PlannedMealEntryDto,
    ];
    const meal = assembleScheduleItems(anchors, [], planned)[0] as MealAnchor;
    expect(meal.description).toBe('Avocado toast');
  });

  it('renders an unmatched floating task at the top instead of dropping it', () => {
    const anchors = [anchor('meal', 'Breakfast', 'meal-1')];
    const entries = [entry({ entry_id: 't4', title: 'Orphan', after_anchor: 'Dinner' })];
    const warn = spyOn(console, 'warn');
    const items = assembleScheduleItems(anchors, entries, []);
    expect(items.length).toBe(2);
    expect((items[0] as ScheduleTask).label).toBe('Orphan');
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From the worktree:

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule-assembly.spec.ts'`
Expected: FAIL — `Cannot find module './schedule-assembly'`.

- [ ] **Step 3: Write the implementation**

Create `plnd_client/src/app/core/utils/schedule-assembly.ts`. This moves the existing pure mappers out of `schedule.service.ts` and adds the assembly walk:

```ts
import { MealAnchor, ScheduleItem, ScheduleTask, parseItemType } from '../models/schedule';
import { ScheduleAnchorDto, ScheduleEntryDto } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';

const MEAL_SLOTS: Record<string, { name: string; emoji: string }> = {
  breakfast: { name: 'Breakfast', emoji: '🥣' },
  lunch:     { name: 'Lunch',     emoji: '🥗' },
  dinner:    { name: 'Dinner',    emoji: '🍽' },
};

/** Folds backend consumption status into the UI MealAnchor.status. */
function toMealUiStatus(status: string | undefined, description?: string): MealAnchor['status'] {
  if (status === 'consumed') return 'done';
  if (status === 'skipped') return 'skipped';
  return description ? 'planned' : 'unplanned';
}

function mapAnchorInstance(
  dto: ScheduleAnchorDto,
  planned?: PlannedMealEntryDto,
  duringMealTasks: ScheduleTask[] = [],
): MealAnchor {
  const slot = MEAL_SLOTS[dto.label.toLowerCase()];
  return {
    id: dto.id as string,
    name: slot?.name ?? dto.label,
    emoji: slot?.emoji ?? '🍴',
    status: toMealUiStatus(dto.status ?? 'planned', planned?.title ?? undefined),
    description: planned?.title ?? undefined,
    duringMealTasks,
  };
}

function mapEntry(e: ScheduleEntryDto): ScheduleTask {
  // Floating = lives in a slot (after_anchor) with no fixed clock time.
  const floating = !e.scheduled_start && !!e.after_anchor;
  return {
    id: e.entry_id,
    type: parseItemType(e.task_type),
    label: e.title ?? e.task_type,
    status: e.status === 'completed' ? 'done' : 'pending',
    scheduledStart: e.scheduled_start ?? undefined,
    durationMinutes: e.duration_minutes ?? undefined,
    energy: (e.energy_required as ScheduleTask['energy']) ?? undefined,
    oneShot: e.one_shot ?? false,
    floating,
  };
}

/**
 * Assemble the ordered slot/anchor sequence (§4.9). Walks `anchors` (pre-sorted
 * by `sequence`) and interleaves floating tasks into the slot after their matched
 * anchor. Every task either has an anchor (`after_anchor`) or is one
 * (`scheduled_start`); during-meal tasks nest via `slot_meal_anchor_id`.
 */
export function assembleScheduleItems(
  anchors: ScheduleAnchorDto[],
  entries: ScheduleEntryDto[],
  plannedMeals: PlannedMealEntryDto[],
): ScheduleItem[] {
  const mealByAnchor = new Map<string, PlannedMealEntryDto>(
    (plannedMeals ?? []).map(pm => [pm.meal_anchor_instance_id, pm]),
  );
  const mealAnchorIds = new Set(
    anchors.filter(a => a.kind === 'meal').map(a => a.id as string),
  );

  const duringByAnchor = new Map<string, ScheduleTask[]>();
  const scheduledByEntryId = new Map<string, ScheduleTask>();
  const floatingByLabel = new Map<string, ScheduleTask[]>();
  const orphans: ScheduleTask[] = [];

  for (const e of entries) {
    const mealAnchorId = e.slot_meal_anchor_id;
    if (mealAnchorId && mealAnchorIds.has(mealAnchorId)) {
      const list = duringByAnchor.get(mealAnchorId) ?? [];
      list.push(mapEntry(e));
      duringByAnchor.set(mealAnchorId, list);
    } else if (e.scheduled_start) {
      scheduledByEntryId.set(e.entry_id, mapEntry(e));
    } else if (e.after_anchor) {
      const key = e.after_anchor.toLowerCase();
      const list = floatingByLabel.get(key) ?? [];
      list.push(mapEntry(e));
      floatingByLabel.set(key, list);
    } else {
      console.warn(`Task ${e.entry_id} has neither an anchor nor a fixed start; rendering at top`);
      orphans.push(mapEntry(e));
    }
  }

  const items: ScheduleItem[] = [];
  const matchedLabels = new Set<string>();
  const emittedScheduled = new Set<string>();

  for (const a of anchors) {
    if (a.kind === 'meal') {
      const id = a.id as string;
      items.push(mapAnchorInstance(a, mealByAnchor.get(id), duringByAnchor.get(id) ?? []));
    } else if (a.kind === 'scheduled_task') {
      const id = a.id as string;
      const task = scheduledByEntryId.get(id);
      if (task) { items.push(task); emittedScheduled.add(id); }
    }
    // start_of_day / end_of_day / timezone_change emit no row.

    const label = a.label.toLowerCase();
    if (!matchedLabels.has(label)) {
      const floats = floatingByLabel.get(label);
      if (floats) { items.push(...floats); matchedLabels.add(label); }
    }
  }

  // Defensive: never drop data. Unresolved floats + any scheduled task whose
  // anchor was absent surface rather than vanish. Expected to be empty.
  const leftover: ScheduleTask[] = [...orphans];
  for (const [label, tasks] of floatingByLabel) {
    if (!matchedLabels.has(label)) {
      console.warn(`Floating task(s) reference unknown anchor "${label}"; rendering at top`);
      leftover.push(...tasks);
    }
  }
  for (const [id, task] of scheduledByEntryId) {
    if (!emittedScheduled.has(id)) {
      console.warn(`Scheduled task ${id} has no anchor in the sequence; appending`);
      items.push(task);
    }
  }

  return [...leftover, ...items];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule-assembly.spec.ts'`
Expected: PASS (6 specs).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_client/src/app/core/utils/schedule-assembly.ts plnd_client/src/app/core/utils/schedule-assembly.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "feat(day-view): pure slot/anchor assembly with floating-task placement (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire `ScheduleService` to `assembleScheduleItems`

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`
- Test: `plnd_client/src/app/core/services/schedule.service.spec.ts` (existing)

- [ ] **Step 1: Update the failing test**

In `plnd_client/src/app/core/services/schedule.service.spec.ts`, add a spec proving a floating task interleaves after its meal anchor (not dumped at the bottom). Add inside the top-level `describe('ScheduleService', ...)`:

```ts
it('interleaves a floating task into the slot after its meal anchor', () => {
  svc.loadDay('2026-04-02');
  const floating = {
    entry_id: 'f1', task_type: 'general', title: 'Walk dog', date: '2026-04-02',
    status: 'pending', after_anchor: 'Breakfast',
  };
  const bfast = anchorDto('meal-1', 'Breakfast');
  const lunch = anchorDto('meal-2', 'Lunch');
  lunch['sequence'] = 1;
  flushDay(httpMock, [floating], [bfast, lunch], []);

  const labels = svc.scheduleItems().map(i =>
    isMealAnchor(i) ? `meal:${i.name}` : `task:${(i as ScheduleTask).label}`);
  expect(labels).toEqual(['meal:Breakfast', 'task:Walk dog', 'meal:Lunch']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule.service.spec.ts'`
Expected: FAIL — current service renders all meals first then `topLevel`, so order is `meal:Breakfast, meal:Lunch, task:Walk dog`.

- [ ] **Step 3: Replace the assembly logic in the service**

In `plnd_client/src/app/core/services/schedule.service.ts`:

1. Add the import:

```ts
import { assembleScheduleItems } from '../utils/schedule-assembly';
```

2. Replace the `.subscribe(...)` body (the current lines that filter `meals`, build `mealByAnchor`/`anchorIds`/`tasksByAnchor`/`topLevel`, and call `this._items.set([...])`) with:

```ts
).subscribe(({ schedule, anchors }) => {
  if (schedule.error) this._error.set('Failed to load schedule');
  this._items.set(assembleScheduleItems(anchors, schedule.data.entries, schedule.data.planned_meals ?? []));
  this._loading.set(false);
});
```

3. Delete the now-unused module functions and imports from `schedule.service.ts`: `MEAL_SLOTS`, `toMealUiStatus`, `mapAnchorInstance`, `mapEntry` (moved to `schedule-assembly.ts`). Keep `flip`, `toApiStatus`, `findItemStatus`, `toPatchBody`, and the `setMealConsumption`/`toggleItem`/`updateEntry` methods. `toMealUiStatus` is still referenced by `setMealConsumption` — keep a copy in the service for that call site, or import it; simplest: keep `toMealUiStatus` in the service (it is also used by `setMealConsumption`). Re-export is not needed.

   Net: remove `MEAL_SLOTS`, `mapAnchorInstance`, `mapEntry` from the service; keep `toMealUiStatus`. Remove now-unused imports (`ScheduleAnchorDto`, `PlannedMealEntryDto`, `parseItemType`) only if no longer referenced — verify with the compiler.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule.service.spec.ts'`
Expected: PASS (existing specs + the new interleave spec). Fix any unused-import lint by removing dead imports flagged by the compiler.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_client/src/app/core/services/schedule.service.ts plnd_client/src/app/core/services/schedule.service.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "refactor(day-view): ScheduleService renders ordered slot sequence (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure `day_zone_view` (backend)

**Files:**
- Modify: `plnd_data/src/timezone/mod.rs` (add function + types + `#[cfg(test)]` tests)

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)] mod tests` block (or add one) in `plnd_data/src/timezone/mod.rs`. If a test module already exists in this file, add these tests to it; otherwise create it. Helper `anchor(...)` builds a `TimezoneAnchor`:

```rust
#[cfg(test)]
mod day_view_tests {
    use super::*;
    use crate::models::TimezoneSource;
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    fn a(date: &str, time: Option<&str>, zone: chrono_tz::Tz) -> TimezoneAnchor {
        TimezoneAnchor {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            effective_date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            effective_time: time.map(|t| NaiveTime::parse_from_str(t, "%H:%M:%S").unwrap()),
            zone,
            source: TimezoneSource::User,
            source_ref: None,
            inference_group: None,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
            updated_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn day(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn same_when_incoming_matches_device() {
        let anchors = vec![a("2026-01-01", None, chrono_tz::America::New_York)];
        let v = day_zone_view(&anchors, day("2026-07-10"), chrono_tz::America::New_York);
        assert_eq!(v.kind, DayZoneKind::Same);
        assert_eq!(v.incoming_zone, Some(chrono_tz::America::New_York));
        assert!(v.switch.is_none());
    }

    #[test]
    fn divergent_when_incoming_differs_from_device() {
        let anchors = vec![a("2026-01-01", None, chrono_tz::America::New_York)];
        let v = day_zone_view(&anchors, day("2026-07-10"), chrono_tz::America::Denver);
        assert_eq!(v.kind, DayZoneKind::Divergent);
    }

    #[test]
    fn travel_when_intraday_switch_on_date() {
        let switch = a("2026-07-10", Some("14:00:00"), chrono_tz::America::Denver);
        let switch_id = switch.id;
        let v = day_zone_view(&[switch], day("2026-07-10"), chrono_tz::America::New_York);
        assert_eq!(v.kind, DayZoneKind::Travel);
        let s = v.switch.unwrap();
        assert_eq!(s.to_zone, chrono_tz::America::Denver);
        // incoming is None → from_zone falls back to device zone (mirrors classifyDay).
        assert_eq!(s.from_zone, chrono_tz::America::New_York);
        assert_eq!(s.anchor_id, switch_id);
    }

    #[test]
    fn empty_anchors_are_same_as_device() {
        let v = day_zone_view(&[], day("2026-07-10"), chrono_tz::America::Denver);
        assert_eq!(v.kind, DayZoneKind::Same);
        assert!(v.incoming_zone.is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just verify rust`
Expected: FAIL — `cannot find function day_zone_view` / `DayZoneKind`.

- [ ] **Step 3: Write the implementation**

Add to `plnd_data/src/timezone/mod.rs` (near `zone_at`). Add `use uuid::Uuid;` to the imports at the top if not present:

```rust
/// Whether the day's effective zone matches the device, differs from it, or
/// changes within the day. Mirrors the client `classifyDay` contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DayZoneKind {
    Same,
    Divergent,
    Travel,
}

/// The first intra-day zone change on the queried date.
#[derive(Debug, Clone)]
pub struct DayZoneSwitch {
    pub from_zone: Tz,
    pub to_zone: Tz,
    pub anchor_id: Uuid,
}

/// Server-side projection of a day's timezone view (§4.8).
#[derive(Debug, Clone)]
pub struct DayZoneProjection {
    pub kind: DayZoneKind,
    pub incoming_zone: Option<Tz>,
    pub current_zone: Tz,
    pub switch: Option<DayZoneSwitch>,
}

/// Classify a day's zone view given the user's anchors and the device zone.
///
/// Faithful port of the former client `classifyDay`: the incoming (start-of-day)
/// zone is `zone_at(date, None)`; a same-date timed anchor makes the day a
/// `Travel` day with a switch from `incoming ?? device` to that anchor's zone;
/// otherwise the day is `Same`/`Divergent` by comparing `incoming ?? device`
/// against the device zone.
pub fn day_zone_view(
    anchors: &[TimezoneAnchor],
    date: NaiveDate,
    device_zone: Tz,
) -> DayZoneProjection {
    let incoming = zone_at(anchors, date, None);

    let mut intraday: Vec<&TimezoneAnchor> = anchors
        .iter()
        .filter(|x| x.effective_date == date && x.effective_time.is_some())
        .collect();
    intraday.sort_by_key(|x| (x.effective_time, x.created_at));

    if let Some(first) = intraday.first() {
        let from_zone = incoming.unwrap_or(device_zone);
        return DayZoneProjection {
            kind: DayZoneKind::Travel,
            incoming_zone: incoming,
            current_zone: device_zone,
            switch: Some(DayZoneSwitch {
                from_zone,
                to_zone: first.zone,
                anchor_id: first.id,
            }),
        };
    }

    let effective = incoming.unwrap_or(device_zone);
    let kind = if effective == device_zone {
        DayZoneKind::Same
    } else {
        DayZoneKind::Divergent
    };
    DayZoneProjection {
        kind,
        incoming_zone: incoming,
        current_zone: device_zone,
        switch: None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just verify rust`
Expected: PASS (new `day_view_tests` plus the existing suite).

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_data/src/timezone/mod.rs
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "feat(timezone): pure day_zone_view projection (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Extend `GET /timezone/resolve` with `device` → `day_view`

**Files:**
- Modify: `plnd_api/src/routes/timezone.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` in `plnd_api/src/routes/timezone.rs` — serialization tests for the new response shape:

```rust
#[test]
fn resolve_response_with_day_view_serializes() {
    let resp = ResolveResponse {
        zone: Some("America/Denver".to_string()),
        day_view: Some(DayZoneViewResponse {
            kind: DayZoneKindResponse::Travel,
            incoming_zone: Some("America/New_York".to_string()),
            current_zone: "America/Denver".to_string(),
            switch: Some(DayZoneSwitchResponse {
                from_zone: "America/New_York".to_string(),
                to_zone: "America/Denver".to_string(),
                anchor_id: Uuid::nil(),
            }),
        }),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"travel\""));
    assert!(json.contains("\"incoming_zone\":\"America/New_York\""));
    assert!(json.contains("\"from_zone\":\"America/New_York\""));
}

#[test]
fn resolve_response_without_day_view_omits_or_nulls_it() {
    let resp = ResolveResponse { zone: None, day_view: None };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"day_view\":null"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just verify rust`
Expected: FAIL — `ResolveResponse` has no `day_view` field; `DayZoneViewResponse` undefined.

- [ ] **Step 3: Write the implementation**

In `plnd_api/src/routes/timezone.rs`:

1. Extend imports:

```rust
use plnd_data::timezone::{DayZoneKind, DayZoneProjection};
```

2. Add response types after `ResolveResponse`:

```rust
/// Wire form of [`plnd_data::timezone::DayZoneKind`].
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DayZoneKindResponse {
    Same,
    Divergent,
    Travel,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DayZoneSwitchResponse {
    pub from_zone: String,
    pub to_zone: String,
    pub anchor_id: Uuid,
}

/// Server-computed day-zone view (replaces the former client `classifyDay`).
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DayZoneViewResponse {
    pub kind: DayZoneKindResponse,
    pub incoming_zone: Option<String>,
    pub current_zone: String,
    pub switch: Option<DayZoneSwitchResponse>,
}

impl From<DayZoneProjection> for DayZoneViewResponse {
    fn from(p: DayZoneProjection) -> Self {
        Self {
            kind: match p.kind {
                DayZoneKind::Same => DayZoneKindResponse::Same,
                DayZoneKind::Divergent => DayZoneKindResponse::Divergent,
                DayZoneKind::Travel => DayZoneKindResponse::Travel,
            },
            incoming_zone: p.incoming_zone.map(|z| z.name().to_string()),
            current_zone: p.current_zone.name().to_string(),
            switch: p.switch.map(|s| DayZoneSwitchResponse {
                from_zone: s.from_zone.name().to_string(),
                to_zone: s.to_zone.name().to_string(),
                anchor_id: s.anchor_id,
            }),
        }
    }
}
```

3. Add `day_view` to `ResolveResponse`:

```rust
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    /// IANA timezone name, or `null` if no anchor covers the requested point.
    pub zone: Option<String>,
    /// Server-computed day-zone view. Present only when the request supplies a
    /// `device` zone; `null` otherwise (backward compatible).
    pub day_view: Option<DayZoneViewResponse>,
}
```

4. Add the `device` query field to `ResolveQuery`:

```rust
    /// Optional device IANA zone. When supplied, the response includes `day_view`.
    pub device: Option<String>,
```

5. In `resolve_zone`, after computing `zone`, compute `day_view`:

```rust
    let day_view = query
        .device
        .as_deref()
        .and_then(|d| d.parse::<chrono_tz::Tz>().ok())
        .map(|device_zone| {
            DayZoneViewResponse::from(plnd_data::timezone::day_zone_view(
                &anchors, query.at, device_zone,
            ))
        });

    Ok(Json(ResolveResponse { zone, day_view }))
```

(Replace the existing `Ok(Json(ResolveResponse { zone }))` line. `anchors` is already in scope from the existing `list_through` call.)

- [ ] **Step 4: Run test to verify it passes**

Run: `just verify rust`
Expected: PASS. If `cargo fmt --check` flags formatting, run `just fmt` first.

- [ ] **Step 5: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_api/src/routes/timezone.rs
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "feat(timezone): /timezone/resolve returns day_view when device supplied (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Client `ResolveResponse` model + `timezone.service.ts`

**Files:**
- Modify: `plnd_client/src/app/core/models/timezone.ts`
- Modify: `plnd_client/src/app/core/services/timezone.service.ts`

- [ ] **Step 1: Update the model**

In `plnd_client/src/app/core/models/timezone.ts`, replace `export interface ResolveResponse { zone: string | null; }` with:

```ts
export type DayZoneKind = 'same' | 'divergent' | 'travel';

export interface DayZoneSwitchDto {
  from_zone: string;
  to_zone: string;
  anchor_id: string;
}

export interface DayZoneViewDto {
  kind: DayZoneKind;
  incoming_zone: string | null;
  current_zone: string;
  switch: DayZoneSwitchDto | null;
}

export interface ResolveResponse {
  zone: string | null;
  day_view?: DayZoneViewDto | null;
}
```

- [ ] **Step 2: Update the service signature**

In `plnd_client/src/app/core/services/timezone.service.ts`, replace `resolve`:

```ts
resolve(at: string, time?: string, device?: string): Observable<ResolveResponse> {
  const params = new URLSearchParams({ at });
  if (time) params.set('time', time);
  if (device) params.set('device', device);
  return this.http.get<ResolveResponse>(`${this.apiBase}/timezone/resolve?${params.toString()}`);
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd plnd_client && npx ng build --configuration development 2>&1 | tail -20`
Expected: builds (no callers broken — `resolve` had no prior callers per blast-radius check).

- [ ] **Step 4: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_client/src/app/core/models/timezone.ts plnd_client/src/app/core/services/timezone.service.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "feat(timezone): client resolve() accepts device and returns day_view (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Day view builds `zoneView` from server `day_view`; retire `classifyDay`

**Files:**
- Modify: `plnd_client/src/app/core/utils/zone-projection.ts`
- Delete: `plnd_client/src/app/core/utils/zone-projection.spec.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.spec.ts`

- [ ] **Step 1: Update the day-view timezone specs**

In `plnd_client/src/app/features/day-view/day-view.spec.ts`, the mocked `tzSvc.resolve` must now return a `day_view`. Update the spy default (line ~67) and the divergent/travel/same specs to drive `zoneView` off `resolve` rather than `classifyDay`-over-`listAnchors`.

Default spy:
```ts
resolve: jasmine.createSpy('resolve').and.returnValue(of({ zone: null, day_view: { kind: 'same', incoming_zone: null, current_zone: 'America/Denver', switch: null } })),
```

Divergent spec (~408): make `resolve` return
```ts
{ zone: 'America/New_York', day_view: { kind: 'divergent', incoming_zone: 'America/New_York', current_zone: 'America/Denver', switch: null } }
```
and keep `listAnchors` returning the anchors (still used by the why-panel). Assert `zoneView()?.kind === 'divergent'` as before.

Travel spec (~462): `resolve` returns
```ts
{ zone: 'America/Denver', day_view: { kind: 'travel', incoming_zone: null, current_zone: 'America/New_York',
  switch: { from_zone: 'America/New_York', to_zone: 'America/Denver', anchor_id: 'anchor-travel' } } }
```
with `listAnchors` returning an anchor whose `id` is `'anchor-travel'` (so the component resolves `switch.anchor` from the list). Assert `zoneView()?.kind === 'travel'` and that `switch.anchor.id === 'anchor-travel'`.

Same spec (~558): `resolve` returns `day_view.kind === 'same'`.

- [ ] **Step 2: Run specs to verify they fail**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/day-view.spec.ts'`
Expected: FAIL — component still calls `classifyDay`; `zoneView` not built from `resolve`.

- [ ] **Step 3: Trim `zone-projection.ts`**

Replace the entire contents of `plnd_client/src/app/core/utils/zone-projection.ts` with just the types (logic removed):

```ts
import { TimezoneAnchorDto } from '../models/timezone';

export interface DaySwitch { fromZone: string; toZone: string; anchor: TimezoneAnchorDto; }
export interface DayZoneView {
  kind: 'same' | 'divergent' | 'travel';
  incomingZone: string | null;   // zone at the start of the day
  currentZone: string;           // zone in effect now
  switch?: DaySwitch;            // present iff kind === 'travel'
}
```

Delete `plnd_client/src/app/core/utils/zone-projection.spec.ts` (its `classifyDay` coverage now lives in `day_view_tests` in `plnd_data/src/timezone/mod.rs`):

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots rm plnd_client/src/app/core/utils/zone-projection.spec.ts
```

- [ ] **Step 4: Update `day-view.ts` `loadZoneView`**

In `plnd_client/src/app/features/day-view/day-view.ts`:

1. Change the import (line 10) — drop `classifyDay`:
```ts
import { DayZoneView, DaySwitch } from '../../core/utils/zone-projection';
```
2. Add `forkJoin` to the rxjs import and `DayZoneViewDto` to the timezone-model import:
```ts
import { forkJoin } from 'rxjs';
import { TimezoneAnchorDto, DayZoneViewDto } from '../../core/models/timezone';
```
3. Replace `loadZoneView` (lines ~209-223) with a version that fetches anchors (for the why-panel) and the server day_view together, then maps:

```ts
private loadZoneView(date: string): void {
  forkJoin({
    anchors: this.tz.listAnchors(date),
    resolved: this.tz.resolve(date, undefined, this.tz.deviceZone()),
  })
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: ({ anchors, resolved }) => {
        this.anchors.set(anchors);
        this.zoneView.set(this.toZoneView(resolved.day_view ?? null, anchors));
      },
      error: () => {
        // Never break the day on a timezone error.
        this.zoneView.set(null);
      },
    });
}

/** Map the server day_view onto the view model, resolving the switch anchor's
 *  full DTO from the already-fetched anchor list (needed by the why-panel). */
private toZoneView(dv: DayZoneViewDto | null, anchors: TimezoneAnchorDto[]): DayZoneView | null {
  if (!dv) return null;
  let sw: DaySwitch | undefined;
  if (dv.kind === 'travel' && dv.switch) {
    const anchor = anchors.find(a => a.id === dv.switch!.anchor_id);
    if (anchor) sw = { fromZone: dv.switch.from_zone, toZone: dv.switch.to_zone, anchor };
  }
  return { kind: dv.kind, incomingZone: dv.incoming_zone, currentZone: dv.current_zone, switch: sw };
}
```

- [ ] **Step 5: Run specs to verify they pass**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/day-view.spec.ts'`
Expected: PASS. Also run the day-header spec (unchanged types) to confirm no breakage:
`cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/day-header.spec.ts'`

- [ ] **Step 6: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add -A plnd_client/src/app/core/utils/zone-projection.ts plnd_client/src/app/features/day-view/day-view.ts plnd_client/src/app/features/day-view/day-view.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "refactor(timezone): day view consumes server day_view; drop client classifyDay (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: E2E — floating tasks across multiple slots

**Files:**
- Create: `plnd_client/e2e/day-view-slots.spec.ts`

- [ ] **Step 1: Inspect the seed helper**

Read `plnd_client/e2e/helpers/seed-data.ts` and `plnd_client/e2e/helpers/auth.ts` to confirm the exact signature of `seedScheduleEntries` (or equivalent) and the meal-anchor/day-type seeding helpers. Use the real helpers — do not extend `/test/seed` (see CLAUDE.md E2E mock policy).

- [ ] **Step 2: Write the e2e test**

Create `plnd_client/e2e/day-view-slots.spec.ts`. Adjust helper names to match what Step 1 found:

```ts
import { test, expect } from '@playwright/test';
import { seedAuth, seedOnboarding } from './helpers/auth';
import { seedScheduleEntries } from './helpers/seed-data';

test('floating tasks render in their slots across the day', async ({ page }) => {
  await seedAuth(page);
  await seedOnboarding(page);

  // A day with breakfast + lunch meal anchors, a scheduled task at 09:00, and
  // floating tasks anchored to start-of-day, breakfast, and the scheduled task.
  await seedScheduleEntries(page, {
    date: '2026-06-16',
    entries: [
      { title: 'Take meds', after_anchor: 'start of day' },
      { title: 'Standup', scheduled_start: '09:00' },
      { title: 'Reply to email', after_anchor: 'Standup' },
      { title: 'Walk the dog', after_anchor: 'Breakfast' },
    ],
  });

  await page.goto('/day/2026-06-16');

  const rows = page.locator('.schedule-list app-task-row, .schedule-list app-meal-row');
  await expect(rows.first()).toBeVisible();

  // Assert order: start-of-day float, Breakfast meal, its float, Standup, its float.
  const texts = await rows.allInnerTexts();
  const joined = texts.join('\n');
  const iMeds = joined.indexOf('Take meds');
  const iBreakfast = joined.indexOf('Breakfast');
  const iDog = joined.indexOf('Walk the dog');
  const iStandup = joined.indexOf('Standup');
  const iEmail = joined.indexOf('Reply to email');

  expect(iMeds).toBeGreaterThanOrEqual(0);
  expect(iMeds).toBeLessThan(iBreakfast);     // start-of-day slot is above breakfast
  expect(iBreakfast).toBeLessThan(iDog);      // dog floats after breakfast
  expect(iDog).toBeLessThan(iStandup);
  expect(iStandup).toBeLessThan(iEmail);      // email floats after the scheduled task
});
```

- [ ] **Step 3: Run the e2e in isolation (optional local check)**

Run: `just verify e2e`
Expected: the new spec passes alongside the suite. If the seed helper differs, fix the test to match the real API (never hardcode tokens; never mock user data).

- [ ] **Step 4: Commit**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots add plnd_client/e2e/day-view-slots.spec.ts
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots commit -m "test(day-view): e2e for floating tasks across slots (#959)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification + PR

- [ ] **Step 1: Format Rust**

Run: `just fmt`

- [ ] **Step 2: Full verify**

Run: `just verify`
Expected: all gates green (quality + build + unit + e2e). Fix any failure before proceeding — no failure is acceptable.

- [ ] **Step 3: Final review before PR**

Use the `superpowers:requesting-code-review` skill (or the code-review skill) on the branch diff BEFORE pushing. Address findings locally.

- [ ] **Step 4: Rebase and open PR**

```bash
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots fetch origin
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots rebase origin/main
git -C /Users/robert/Development/plnd/.claude/worktrees/fix+959-day-view-slots push -u origin HEAD --force-with-lease
gh pr create --title "fix(day-view): render slot/anchor sequence; place floating tasks in slots" --body "Closes #959"
```

Then invoke the `monitor-pr` skill.

---

## Notes / decisions baked in

- **No visible SOD/EOD rows** — they bound the sequence only (per design decision). `start_of_day`/`end_of_day`/`timezone_change` anchors emit no `ScheduleItem`.
- **Invariant** — every task has an anchor (`after_anchor`) or is one (`scheduled_start`); the defensive leftover handling exists only to never drop data, not as a designed slot.
- **`listAnchors` stays** — the why-panel needs the full `TimezoneAnchorDto`; the server `day_view` only moves the *resolution* off the client, and supplies `switch.anchor_id` which the client resolves against that list.
- **`resolve` stays backward compatible** — without `device`, `day_view` is `null` and behavior is unchanged.
```
