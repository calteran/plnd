# Task Drag-Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag floating/paired tasks into a preferred order — within a slot, between slots, into/out of a meal pairing, and (in the wizards) across days — in the day view and both planning-wizard review layouts, with the order persisting.

**Architecture:** A new persisted `slot_position` integer on `schedule_entries` is the cross-surface spine. A floating/paired task's placement is `(date, slot key, slot_position)` where the slot key is `after_anchor` (slot task) or `slot_meal_anchor_id` (paired task). The day view persists each drop through a dedicated `PATCH /schedule/entries/{id}/position` op that renumbers slots in one transaction; the two wizards reorder in-memory signal arrays and send explicit `slot_position` (and `paired_meal_name`) at commit. Two `DEFERRABLE INITIALLY DEFERRED` unique constraints enforce per-slot position uniqueness.

**Tech Stack:** Rust (Axum, sqlx, Postgres), Angular 22 (signals, OnPush, standalone components), `@angular/cdk` DragDropModule (new dependency), Playwright e2e.

## Global Constraints

- **Controlling reference:** `docs/architecture.md` §4.6–4.9. Floating tasks live in slots; meals reorder by `preferred_time` and scheduled tasks are anchors — **anchors are never dragged**, only floating/paired tasks.
- **Floating-task contract:** a floating/paired task persists `scheduled_start = NULL` (a fabricated clock time collapses it onto an anchor). `reposition_entry` always forces `scheduled_start = NULL`.
- **Storage isolation:** only `plnd_data` touches `sqlx`/`PgPool`; `plnd_api` calls trait methods on `plnd_data::repository`. New storage work adds a method to `ScheduleRepository`.
- **Testing:** never run `just test`/`just test-ci`. Pre-commit gate is `just verify` (bare, never piped); run `just fmt` first. Documentation-only changes are exempt. Angular-only unit runs use `npx ng test` from the worktree's `plnd_client/`.
- **Branch discipline:** branch from `main`; never commit to `main`. Rebase onto `origin/main` before every push.
- **Migrations:** sqlx embeds migrations at compile time — touch a `plnd_data` source file when adding a migration so test/API binaries re-embed. After rebasing, check `ls plnd_data/migrations/` for version-prefix collisions and renumber if needed. No backfill needed (dev DB is wiped each build).
- **Mock policy:** schedule endpoints are served by the real backend in e2e; only agent/LLM endpoints are mocked. Seed via real API helpers.
- **A11y:** v1 is drag-only; a non-drag keyboard/button reorder path is tracked by a follow-up issue (Task 14), not built here.

---

## Phase 1 — Backend foundation

Files in play this phase:
- `plnd_data/migrations/0052_schedule_entries_slot_position.sql` (create)
- `plnd_data/migrations/0053_schedule_entries_slot_position_unique.sql` (create)
- `plnd_data/src/models/schedule.rs` (modify — `ScheduleEntry`, `PlanEntryInput`)
- `plnd_data/src/db/schedule.rs` (modify — `ENTRY_COLS`, `get_period`, `get_carryover`, `commit_plan`, new `reposition_entry`)
- `plnd_data/src/repository/schedule.rs` (modify — trait + `SlotTarget`)
- `plnd_data/src/repository/pg/schedule.rs` (modify — impl)
- `plnd_api/src/models.rs` (modify — `PlanEntryRequest`, new `RepositionEntryRequest`)
- `plnd_api/src/routes/schedule.rs` (modify — `map_entry`, new `reposition_entry` handler)
- `plnd_api/src/main.rs` (modify — route registration)

### Task 1: Add `slot_position` column + model field + constraints

**Files:**
- Create: `plnd_data/migrations/0052_schedule_entries_slot_position.sql`
- Create: `plnd_data/migrations/0053_schedule_entries_slot_position_unique.sql`
- Modify: `plnd_data/src/models/schedule.rs:34-59` (`ScheduleEntry`)
- Modify: `plnd_data/src/db/schedule.rs:17-20` (`ENTRY_COLS`)
- Test: `plnd_data/src/db/schedule.rs` (tests module)

**Interfaces:**
- Produces: `ScheduleEntry.slot_position: i32`; column `schedule_entries.slot_position INT NOT NULL DEFAULT 0`; constraints `schedule_entries_slot_after_anchor_position_key`, `schedule_entries_slot_meal_anchor_position_key`.

- [ ] **Step 1: Write the column migration**

`plnd_data/migrations/0052_schedule_entries_slot_position.sql`:

```sql
-- Per-slot ordering for floating/paired tasks (§4.9 user-sequencing).
-- Meaningful only for tasks that live in a slot (after_anchor) or are paired
-- with a meal (slot_meal_anchor_id); scheduled-task anchors ignore it.
ALTER TABLE schedule_entries
    ADD COLUMN slot_position INT NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Write the uniqueness migration**

`plnd_data/migrations/0053_schedule_entries_slot_position_unique.sql`:

```sql
-- One position per task within a (date, slot). The slot key is polymorphic:
-- after_anchor for slot tasks, slot_meal_anchor_id for paired tasks. Postgres
-- treats NULLs as distinct, so each task type is constrained by exactly one of
-- these (scheduled-task anchors, with both NULL, by neither). DEFERRABLE so the
-- reposition transaction can pass through transient collisions (0,1,2 -> 1,2,3)
-- and is validated only at COMMIT.
ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_slot_after_anchor_position_key
        UNIQUE (user_id, date, after_anchor, slot_position)
        DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_slot_meal_anchor_position_key
        UNIQUE (user_id, date, slot_meal_anchor_id, slot_position)
        DEFERRABLE INITIALLY DEFERRED;
```

- [ ] **Step 3: Add the model field**

In `plnd_data/src/models/schedule.rs`, add to `ScheduleEntry` after `one_shot` (line 56):

```rust
    pub one_shot: bool,
    /// Per-slot ordering for floating/paired tasks (§4.9). 0 for scheduled-task
    /// anchors, which don't live in a slot.
    pub slot_position: i32,
    pub created_at: DateTime<Utc>,
```

- [ ] **Step 4: Add the column to `ENTRY_COLS`**

In `plnd_data/src/db/schedule.rs`, update `ENTRY_COLS` (line 17) to include `slot_position` — it must be selected or `FromRow` fails:

```rust
const ENTRY_COLS: &str = "entry_id, user_id, routine_id, task_type, title,
     date, scheduled_start, scheduled_end, status, actual_start, actual_end,
     after_anchor, slot_meal_anchor_id, deviation_note,
     duration_minutes, energy_required, one_shot, slot_position, created_at, updated_at";
```

- [ ] **Step 5: Write the failing test**

Add to the `tests` module in `plnd_data/src/db/schedule.rs`. Self-contained (raw SQL insert — no dependency on `PlanEntryInput`, which gains its field in Task 3):

```rust
#[sqlx::test(migrations = "./migrations")]
async fn slot_position_column_exists_and_defaults_zero(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d = tomorrow();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO schedule_entries (user_id, task_type, title, date, status, after_anchor)
         VALUES ($1, 'work', 'a', $2, 'planned', 'lunch') RETURNING entry_id",
    ).bind(uid).bind(d).fetch_one(&pool).await.unwrap();

    let pos: i32 = sqlx::query_scalar(
        "SELECT slot_position FROM schedule_entries WHERE entry_id = $1",
    ).bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(pos, 0, "new column defaults to 0");
}
```

The existing `get_period`/`commit_plan` tests also exercise the `ENTRY_COLS` change — if `slot_position` were missing from `ENTRY_COLS`, `FromRow` for `ScheduleEntry` would fail to map the row.

- [ ] **Step 6: Run the test + suite**

Run: `just fmt && just verify rust`
Expected: PASS — the new test is green and every existing `schedule.rs` DB test still passes with `slot_position` in both `ENTRY_COLS` and the struct.

- [ ] **Step 7: Commit**

```bash
git add plnd_data/migrations/0052_schedule_entries_slot_position.sql \
        plnd_data/migrations/0053_schedule_entries_slot_position_unique.sql \
        plnd_data/src/models/schedule.rs plnd_data/src/db/schedule.rs
git commit -m "feat(schedule): add slot_position column + per-slot unique constraints"
```

### Task 2: Order reads by `slot_position`

**Files:**
- Modify: `plnd_data/src/db/schedule.rs:29-34` (`get_period`), `:53-59` (`get_carryover`)
- Test: `plnd_data/src/db/schedule.rs` (tests module)

**Interfaces:**
- Consumes: `slot_position` column (Task 1).
- Produces: floating tasks returned in `slot_position` order within a `(date, after_anchor)` group.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module. Self-contained (raw SQL inserts that set `slot_position` directly — the column exists from Task 1, so this test compiles and runs at Task 2 with no dependency on Task 3). It inserts three floating "lunch" tasks with positions 2,0,1 and asserts read order.

```rust
#[sqlx::test(migrations = "./migrations")]
async fn get_period_orders_floating_tasks_by_slot_position(pool: PgPool) {
    let uid = new_user(&pool).await;
    let start = tomorrow();
    let sched = NaiveTime::from_hms_opt(8, 0, 0).unwrap();

    // Insert three floating "lunch" tasks with positions 2,0,1 in that order.
    for (title, pos) in [("c", 2), ("a", 0), ("b", 1)] {
        sqlx::query(
            "INSERT INTO schedule_entries
               (user_id, task_type, title, date, status, after_anchor, slot_position)
             VALUES ($1, 'work', $2, $3, 'planned', 'lunch', $4)",
        )
        .bind(uid).bind(title).bind(start).bind(pos)
        .execute(&pool).await.unwrap();
    }
    let _ = sched;

    let period = get_period(&pool, uid, start, start).await.unwrap();
    let titles: Vec<&str> = period.entries.iter()
        .filter(|e| e.after_anchor.as_deref() == Some("lunch"))
        .map(|e| e.title.as_deref().unwrap()).collect();
    assert_eq!(titles, vec!["a", "b", "c"], "must come back in slot_position order");
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `just verify rust` (or `cargo nextest` is not permitted — use `just verify rust`)
Expected: FAIL — current `ORDER BY date, scheduled_start` ignores `slot_position`, so order is non-deterministic / wrong.

- [ ] **Step 3: Update both queries**

In `get_period` (line 33) and `get_carryover` (line 58), change the `ORDER BY` clause to:

```sql
ORDER BY date, slot_position, scheduled_start, entry_id
```

- [ ] **Step 4: Run the test**

Run: `just verify rust`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plnd_data/src/db/schedule.rs
git commit -m "feat(schedule): order slot tasks by slot_position on read"
```

### Task 3: Persist `slot_position` + resolve `paired_meal_name` in `commit_plan`

**Files:**
- Modify: `plnd_data/src/models/schedule.rs:97-106` (`PlanEntryInput`)
- Modify: `plnd_data/src/db/schedule.rs:233-286` (commit insert) and the test helper `work_entry` (line 524)
- Test: `plnd_data/src/db/schedule.rs` (tests module)

**Interfaces:**
- Consumes: `slot_position` column + constraints (Task 1); the `(date, name) -> meal_anchor_instances.id` lookup pattern from `pair_and_insert_meal_entries` (lines 388-442).
- Produces: `PlanEntryInput.slot_position: Option<i32>`, `PlanEntryInput.paired_meal_name: Option<String>`; committed floating/paired tasks carry distinct `slot_position` per slot and a resolved `slot_meal_anchor_id` when paired.

- [ ] **Step 1: Extend `PlanEntryInput`**

In `plnd_data/src/models/schedule.rs`, add two fields to `PlanEntryInput` (after `one_shot`, line 105):

```rust
    pub one_shot: Option<bool>,
    /// 0-based order within (date, slot). Defaults to 0 when omitted.
    pub slot_position: Option<i32>,
    /// Pre-materialization meal pairing: resolved to slot_meal_anchor_id at
    /// commit by matching (date, name) against meal_anchor_instances.
    pub paired_meal_name: Option<String>,
```

- [ ] **Step 2: Update the `work_entry` test helper and every `PlanEntryInput { .. }` literal in the tests module**

In `plnd_data/src/db/schedule.rs`, `work_entry` (line 524) and the inline `PlanEntryInput` literals (the bucket-task, bad-entry, non-meal-anchor, duration/energy, legacy-meal, etc. tests) each need the two new fields. For `work_entry`:

```rust
    fn work_entry(date: NaiveDate) -> PlanEntryInput {
        PlanEntryInput {
            date,
            task_type: Some("work".to_string()),
            title: Some("Test task".to_string()),
            scheduled_start: Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
            slot_position: None,
            paired_meal_name: None,
        }
    }
```

Add `slot_position: None, paired_meal_name: None,` to each other literal (bucket task in `commit_plan_supports_bucket_task_with_null_scheduled_start`, the `bad_entry`, the `commit_plan_accepts_non_meal_after_anchor` entry, the duration/energy entry, the legacy meal-anchor entry). The `#[cfg(any())]` dead test may be left as-is.

- [ ] **Step 3: Write the failing tests**

Add two tests to the module:

```rust
#[sqlx::test(migrations = "./migrations")]
async fn commit_plan_persists_distinct_slot_positions_in_one_slot(pool: PgPool) {
    let uid = new_user(&pool).await;
    let start = tomorrow();
    let end = start + Duration::days(6);
    let task_id = make_planning_task(&pool, uid, start).await;

    let mk = |title: &str, pos: i32| PlanEntryInput {
        date: start,
        task_type: Some("work".to_string()),
        title: Some(title.to_string()),
        scheduled_start: None,
        after_anchor: Some("lunch".to_string()),
        duration_minutes: None,
        energy_required: None,
        one_shot: None,
        slot_position: Some(pos),
        paired_meal_name: None,
    };

    let req = CommitPlanInput {
        plan_start: start, plan_end: end, planning_task_id: task_id,
        entries: vec![mk("a", 0), mk("b", 1), mk("c", 2)],
        meal_entries: Vec::new(), replace: false,
        carryover_decisions: HashMap::new(), drop_reasons: HashMap::new(),
    };
    // Without slot_position population this fails the deferred unique constraint
    // (three rows at (date,'lunch',0)).
    commit_plan(&pool, uid, &req).await.unwrap();

    let period = get_period(&pool, uid, start, start).await.unwrap();
    let mut by_pos: Vec<(i32, String)> = period.entries.iter()
        .map(|e| (e.slot_position, e.title.clone().unwrap())).collect();
    by_pos.sort();
    assert_eq!(by_pos, vec![(0, "a".into()), (1, "b".into()), (2, "c".into())]);
}

#[sqlx::test(migrations = "./migrations")]
async fn commit_plan_resolves_paired_meal_name_to_instance(pool: PgPool) {
    let uid = new_user(&pool).await;
    let start = tomorrow();
    let end = start + Duration::days(6);
    let task_id = make_planning_task(&pool, uid, start).await;

    let instance = crate::db::meal_anchor_instance::add(
        &pool, uid, start, "breakfast",
        NaiveTime::from_hms_opt(8, 0, 0).unwrap(), 60,
    ).await.unwrap();

    let entry = PlanEntryInput {
        date: start,
        task_type: Some("medication".to_string()),
        title: Some("Take pills with food".to_string()),
        scheduled_start: None,
        after_anchor: None,
        duration_minutes: None,
        energy_required: None,
        one_shot: None,
        slot_position: Some(0),
        paired_meal_name: Some("breakfast".to_string()),
    };

    let req = CommitPlanInput {
        plan_start: start, plan_end: end, planning_task_id: task_id,
        entries: vec![entry], meal_entries: Vec::new(), replace: false,
        carryover_decisions: HashMap::new(), drop_reasons: HashMap::new(),
    };
    commit_plan(&pool, uid, &req).await.unwrap();

    let anchor_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT slot_meal_anchor_id FROM schedule_entries WHERE user_id = $1",
    ).bind(uid).fetch_one(&pool).await.unwrap();
    assert_eq!(anchor_id, Some(instance.id), "paired_meal_name must resolve to the instance id");
}
```

- [ ] **Step 4: Run them to confirm failure**

Run: `just verify rust`
Expected: FAIL — first test trips the deferred unique constraint at COMMIT (all positions default 0); second leaves `slot_meal_anchor_id` NULL.

- [ ] **Step 5: Implement population + resolution in `commit_plan`**

In `plnd_data/src/db/schedule.rs` `commit_plan`, before the insert loop (line 237), resolve paired meal names. Add after the `replace` block (line 232) and before the per-entry vectors:

```rust
    // Resolve paired_meal_name -> meal_anchor_instances.id for this commit.
    // Instances are materialized earlier in planning, so they exist by now.
    let mut paired_lookup: HashMap<(NaiveDate, String), Uuid> = HashMap::new();
    {
        let pairs: Vec<(NaiveDate, String)> = req
            .entries
            .iter()
            .filter_map(|e| e.paired_meal_name.clone().map(|n| (e.date, n)))
            .collect();
        if !pairs.is_empty() {
            let dates: Vec<NaiveDate> = pairs.iter().map(|(d, _)| *d).collect();
            let names: Vec<String> = pairs.iter().map(|(_, n)| n.clone()).collect();
            let rows: Vec<(NaiveDate, String, Uuid)> = sqlx::query_as(
                "SELECT mai.date, mai.name, mai.id FROM meal_anchor_instances mai
                 JOIN UNNEST($2::date[], $3::text[]) AS req(date, name)
                      ON req.date = mai.date AND req.name = mai.name
                 WHERE mai.user_id = $1",
            )
            .bind(user_id).bind(&dates).bind(&names)
            .fetch_all(&mut *tx).await.map_err(DatabaseError::from)?;
            for (d, n, id) in rows {
                paired_lookup.insert((d, n), id);
            }
        }
    }
```

Then extend the per-entry vectors (line 237) with two more, and populate them in the loop (line 246). Replace the loop body to compute `slot_meal_anchor_id` and `slot_position`:

```rust
    let mut slot_meal_anchor_ids: Vec<Option<Uuid>> = Vec::new();
    let mut slot_positions: Vec<i32> = Vec::new();

    for entry in &req.entries {
        let Some(task_type) = entry.task_type.clone() else {
            continue;
        };
        // Paired task: resolve the meal name to an instance id. On miss, fall
        // back to floating in the same-named slot (logged, never dropped).
        let (after_anchor, slot_meal_anchor_id) = match &entry.paired_meal_name {
            Some(name) => match paired_lookup.get(&(entry.date, name.clone())) {
                Some(id) => (None, Some(*id)),
                None => {
                    tracing::warn!(date = %entry.date, meal = %name,
                        "paired_meal_name resolved to no instance; floating in slot");
                    (Some(name.clone()), None)
                }
            },
            None => (entry.after_anchor.clone(), None),
        };
        task_types.push(task_type);
        titles.push(entry.title.clone());
        dates.push(entry.date);
        scheduled_starts.push(entry.scheduled_start);
        after_anchors.push(after_anchor);
        slot_meal_anchor_ids.push(slot_meal_anchor_id);
        slot_positions.push(entry.slot_position.unwrap_or(0));
        duration_minutes_vals.push(entry.duration_minutes);
        energy_required_vals.push(entry.energy_required.clone());
        one_shot_vals.push(entry.one_shot.unwrap_or(false));
    }
```

Update the `INSERT` (lines 262-280) to include the two new columns:

```rust
        sqlx::query_as::<_, InsertedRow>(
            "INSERT INTO schedule_entries
               (user_id, task_type, title,
                date, scheduled_start, status, after_anchor,
                slot_meal_anchor_id, slot_position,
                duration_minutes, energy_required, one_shot)
             SELECT $1, unnest($2::text[]),
                    unnest($3::text[]), unnest($4::date[]), unnest($5::time[]),
                    'planned', unnest($6::text[]),
                    unnest($7::uuid[]), unnest($8::int4[]),
                    unnest($9::int4[]), unnest($10::text[]), unnest($11::bool[])
             RETURNING entry_id, title, date, after_anchor",
        )
        .bind(user_id)
        .bind(&task_types)
        .bind(&titles)
        .bind(&dates)
        .bind(&scheduled_starts)
        .bind(&after_anchors)
        .bind(&slot_meal_anchor_ids)
        .bind(&slot_positions)
        .bind(&duration_minutes_vals)
        .bind(&energy_required_vals)
        .bind(&one_shot_vals)
        .fetch_all(&mut *tx)
        .await
        .map_err(DatabaseError::from)?
```

- [ ] **Step 6: Run the tests**

Run: `just verify rust`
Expected: PASS (both new tests, plus the Task 2 `get_period_orders_floating_tasks_by_slot_position` and Task 1 `slot_position_column_exists_and_defaults_zero` now compile and pass — remove any `#[ignore]`).

- [ ] **Step 7: Commit**

```bash
git add plnd_data/src/models/schedule.rs plnd_data/src/db/schedule.rs
git commit -m "feat(schedule): persist slot_position and resolve paired_meal_name on commit"
```

### Task 4: `reposition_entry` — the live move operation

**Files:**
- Modify: `plnd_data/src/db/schedule.rs` (new `reposition_entry` fn)
- Modify: `plnd_data/src/repository/schedule.rs` (new `SlotTarget` + trait method)
- Modify: `plnd_data/src/repository/pg/schedule.rs` (impl)
- Test: `plnd_data/src/db/schedule.rs` (tests module)

**Interfaces:**
- Produces:
  - `pub enum SlotTarget { AfterAnchor(String), MealAnchor(Uuid) }` in `plnd_data::repository::schedule` (re-exported via `plnd_data::models`? no — keep in repository module and import where needed).
  - `db::schedule::reposition_entry(pool, user_id, entry_id, date: NaiveDate, target: &SlotTarget, position: i32) -> Result<(), DatabaseError>`
  - `ScheduleRepository::reposition_entry(&self, user_id, entry_id, date, target: &SlotTarget, position) -> Result<(), crate::Error>`

- [ ] **Step 1: Define `SlotTarget` in the repository trait module**

In `plnd_data/src/repository/schedule.rs`, add above the trait:

```rust
/// Target slot for a reposition. Exactly one slot key — a floating task's
/// `after_anchor` or a paired task's `slot_meal_anchor_id`.
#[derive(Debug, Clone)]
pub enum SlotTarget {
    AfterAnchor(String),
    MealAnchor(Uuid),
}
```

Add the trait method (after `update_entry`, line 48):

```rust
    async fn reposition_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        date: NaiveDate,
        target: &SlotTarget,
        position: i32,
    ) -> Result<(), crate::Error>;
```

- [ ] **Step 2: Write the failing integration tests**

Add to the `tests` module in `plnd_data/src/db/schedule.rs`. Import the enum: `use crate::repository::schedule::SlotTarget;` inside the test module.

```rust
async fn insert_floating(pool: &PgPool, uid: Uuid, date: NaiveDate,
                         title: &str, anchor: &str, pos: i32) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO schedule_entries
           (user_id, task_type, title, date, status, after_anchor, slot_position)
         VALUES ($1, 'work', $2, $3, 'planned', $4, $5) RETURNING entry_id",
    ).bind(uid).bind(title).bind(date).bind(anchor).bind(pos)
     .fetch_one(pool).await.unwrap()
}

async fn slot_order(pool: &PgPool, uid: Uuid, date: NaiveDate, anchor: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT title FROM schedule_entries
         WHERE user_id = $1 AND date = $2 AND after_anchor = $3
         ORDER BY slot_position",
    ).bind(uid).bind(date).bind(anchor).fetch_all(pool).await.unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn reposition_within_slot_reorders(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d = tomorrow();
    let a = insert_floating(&pool, uid, d, "a", "lunch", 0).await;
    let _b = insert_floating(&pool, uid, d, "b", "lunch", 1).await;
    let _c = insert_floating(&pool, uid, d, "c", "lunch", 2).await;

    // Move "a" to the end (position 2).
    reposition_entry(&pool, uid, a, d, &SlotTarget::AfterAnchor("lunch".into()), 2)
        .await.unwrap();
    assert_eq!(slot_order(&pool, uid, d, "lunch").await, vec!["b", "c", "a"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn reposition_between_slots_moves_and_compacts(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d = tomorrow();
    let a = insert_floating(&pool, uid, d, "a", "lunch", 0).await;
    let _b = insert_floating(&pool, uid, d, "b", "lunch", 1).await;
    let _x = insert_floating(&pool, uid, d, "x", "dinner", 0).await;

    reposition_entry(&pool, uid, a, d, &SlotTarget::AfterAnchor("dinner".into()), 0)
        .await.unwrap();
    assert_eq!(slot_order(&pool, uid, d, "lunch").await, vec!["b"]);
    assert_eq!(slot_order(&pool, uid, d, "dinner").await, vec!["a", "x"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn reposition_into_and_out_of_meal_pairing(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d = tomorrow();
    let instance = crate::db::meal_anchor_instance::add(
        &pool, uid, d, "lunch", NaiveTime::from_hms_opt(12, 0, 0).unwrap(), 60,
    ).await.unwrap();
    let a = insert_floating(&pool, uid, d, "a", "lunch", 0).await;

    // Into the meal pairing.
    reposition_entry(&pool, uid, a, d, &SlotTarget::MealAnchor(instance.id), 0)
        .await.unwrap();
    let (after, meal, sched): (Option<String>, Option<Uuid>, Option<NaiveTime>) =
        sqlx::query_as("SELECT after_anchor, slot_meal_anchor_id, scheduled_start
                        FROM schedule_entries WHERE entry_id = $1")
            .bind(a).fetch_one(&pool).await.unwrap();
    assert_eq!(after, None);
    assert_eq!(meal, Some(instance.id));
    assert_eq!(sched, None, "reposition forces scheduled_start NULL");

    // Back out to a slot.
    reposition_entry(&pool, uid, a, d, &SlotTarget::AfterAnchor("dinner".into()), 0)
        .await.unwrap();
    let (after2, meal2): (Option<String>, Option<Uuid>) =
        sqlx::query_as("SELECT after_anchor, slot_meal_anchor_id
                        FROM schedule_entries WHERE entry_id = $1")
            .bind(a).fetch_one(&pool).await.unwrap();
    assert_eq!(after2, Some("dinner".to_string()));
    assert_eq!(meal2, None);
}

#[sqlx::test(migrations = "./migrations")]
async fn reposition_across_days(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d1 = tomorrow();
    let d2 = d1 + Duration::days(1);
    let a = insert_floating(&pool, uid, d1, "a", "lunch", 0).await;
    let _y = insert_floating(&pool, uid, d2, "y", "lunch", 0).await;

    reposition_entry(&pool, uid, a, d2, &SlotTarget::AfterAnchor("lunch".into()), 0)
        .await.unwrap();
    let new_date: NaiveDate =
        sqlx::query_scalar("SELECT date FROM schedule_entries WHERE entry_id = $1")
            .bind(a).fetch_one(&pool).await.unwrap();
    assert_eq!(new_date, d2);
    assert_eq!(slot_order(&pool, uid, d2, "lunch").await, vec!["a", "y"]);
    assert!(slot_order(&pool, uid, d1, "lunch").await.is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn reposition_unknown_entry_is_not_found(pool: PgPool) {
    let uid = new_user(&pool).await;
    let d = tomorrow();
    let err = reposition_entry(
        &pool, uid, Uuid::new_v4(), d, &SlotTarget::AfterAnchor("lunch".into()), 0,
    ).await.unwrap_err();
    assert!(matches!(err, DatabaseError::NotFound));
}
```

- [ ] **Step 3: Run them to confirm failure**

Run: `just verify rust`
Expected: FAIL to compile — `reposition_entry` and `SlotTarget` don't exist yet.

- [ ] **Step 4: Implement `reposition_entry`**

Add to `plnd_data/src/db/schedule.rs` (after `update_entry`, line 160). It implements remove-then-insert with the source slot compacted; the deferred constraints validate at COMMIT.

```rust
use crate::repository::schedule::SlotTarget;

#[tracing::instrument(skip(pool), fields(table = "schedule_entries", op = "reposition_entry"))]
pub async fn reposition_entry(
    pool: &PgPool,
    user_id: Uuid,
    entry_id: Uuid,
    date: NaiveDate,
    target: &SlotTarget,
    position: i32,
) -> Result<(), DatabaseError> {
    let mut tx = pool.begin().await.map_err(DatabaseError::from)?;

    // Load and lock the entry's current slot.
    let current: Option<(NaiveDate, Option<String>, Option<Uuid>, i32)> = sqlx::query_as(
        "SELECT date, after_anchor, slot_meal_anchor_id, slot_position
         FROM schedule_entries WHERE entry_id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(entry_id).bind(user_id)
    .fetch_optional(&mut *tx).await.map_err(DatabaseError::from)?;
    let Some((src_date, src_after, src_meal, src_pos)) = current else {
        return Err(DatabaseError::NotFound);
    };

    let position = position.max(0);

    // Step 1: compact the SOURCE slot (close the hole the entry leaves), excl. entry.
    match (&src_after, &src_meal) {
        (Some(a), None) => {
            sqlx::query(
                "UPDATE schedule_entries SET slot_position = slot_position - 1
                 WHERE user_id = $1 AND date = $2 AND after_anchor = $3
                   AND slot_meal_anchor_id IS NULL
                   AND slot_position > $4 AND entry_id <> $5",
            ).bind(user_id).bind(src_date).bind(a).bind(src_pos).bind(entry_id)
             .execute(&mut *tx).await.map_err(DatabaseError::from)?;
        }
        (None, Some(m)) => {
            sqlx::query(
                "UPDATE schedule_entries SET slot_position = slot_position - 1
                 WHERE user_id = $1 AND date = $2 AND slot_meal_anchor_id = $3
                   AND after_anchor IS NULL
                   AND slot_position > $4 AND entry_id <> $5",
            ).bind(user_id).bind(src_date).bind(m).bind(src_pos).bind(entry_id)
             .execute(&mut *tx).await.map_err(DatabaseError::from)?;
        }
        _ => {} // entry had no slot (e.g. was a scheduled task) — nothing to compact.
    }

    // Step 2: open a gap in the TARGET slot at `position`, excl. entry.
    let (tgt_after, tgt_meal): (Option<String>, Option<Uuid>) = match target {
        SlotTarget::AfterAnchor(a) => {
            sqlx::query(
                "UPDATE schedule_entries SET slot_position = slot_position + 1
                 WHERE user_id = $1 AND date = $2 AND after_anchor = $3
                   AND slot_meal_anchor_id IS NULL
                   AND slot_position >= $4 AND entry_id <> $5",
            ).bind(user_id).bind(date).bind(a).bind(position).bind(entry_id)
             .execute(&mut *tx).await.map_err(DatabaseError::from)?;
            (Some(a.clone()), None)
        }
        SlotTarget::MealAnchor(m) => {
            sqlx::query(
                "UPDATE schedule_entries SET slot_position = slot_position + 1
                 WHERE user_id = $1 AND date = $2 AND slot_meal_anchor_id = $3
                   AND after_anchor IS NULL
                   AND slot_position >= $4 AND entry_id <> $5",
            ).bind(user_id).bind(date).bind(m).bind(position).bind(entry_id)
             .execute(&mut *tx).await.map_err(DatabaseError::from)?;
            (None, Some(*m))
        }
    };

    // Step 3: place the entry. Floating contract: scheduled_start = NULL.
    let updated = sqlx::query(
        "UPDATE schedule_entries SET
             date = $1, after_anchor = $2, slot_meal_anchor_id = $3,
             scheduled_start = NULL, slot_position = $4, updated_at = NOW()
         WHERE entry_id = $5 AND user_id = $6",
    )
    .bind(date).bind(&tgt_after).bind(&tgt_meal).bind(position)
    .bind(entry_id).bind(user_id)
    .execute(&mut *tx).await.map_err(DatabaseError::from)?;
    if updated.rows_affected() == 0 {
        return Err(DatabaseError::NotFound);
    }

    tx.commit().await.map_err(DatabaseError::from)?;
    Ok(())
}
```

- [ ] **Step 5: Wire the repository trait + impl**

In `plnd_data/src/repository/pg/schedule.rs`, add the import and impl method:

```rust
use crate::repository::schedule::{ScheduleRepository, SlotTarget};
```

```rust
    async fn reposition_entry(
        &self,
        user_id: Uuid,
        entry_id: Uuid,
        date: NaiveDate,
        target: &SlotTarget,
        position: i32,
    ) -> Result<(), crate::Error> {
        schedule::reposition_entry(&self.pool, user_id, entry_id, date, target, position)
            .await
            .map_err(Into::into)
    }
```

- [ ] **Step 6: Run the tests**

Run: `just fmt && just verify rust`
Expected: PASS (all five reposition tests).

- [ ] **Step 7: Commit**

```bash
git add plnd_data/src/db/schedule.rs plnd_data/src/repository/schedule.rs \
        plnd_data/src/repository/pg/schedule.rs
git commit -m "feat(schedule): add reposition_entry move operation"
```

### Task 5: `PATCH /schedule/entries/{id}/position` endpoint + request plumbing

**Files:**
- Modify: `plnd_api/src/models.rs:104-117` (`PlanEntryRequest`) + new `RepositionEntryRequest`
- Modify: `plnd_api/src/routes/schedule.rs` (`map_entry`, new `reposition_entry` handler)
- Modify: `plnd_api/src/main.rs:385` (route)
- Test: `plnd_api/src/routes/schedule.rs` (tests module — validation unit tests)

**Interfaces:**
- Consumes: `ScheduleRepository::reposition_entry`, `SlotTarget` (Task 4); `PlanEntryInput.slot_position`/`paired_meal_name` (Task 3).
- Produces: HTTP `PATCH /schedule/entries/{id}/position`; `PlanEntryRequest` now carries `slot_position` + `paired_meal_name` through `map_entry`.

- [ ] **Step 1: Extend `PlanEntryRequest` and add `RepositionEntryRequest`**

In `plnd_api/src/models.rs`, add to `PlanEntryRequest` (after `one_shot`, line 116):

```rust
    #[serde(default)]
    pub one_shot: Option<bool>,
    /// 0-based order within (date, slot). Sent by the planning wizards.
    #[serde(default)]
    pub slot_position: Option<i32>,
    /// Pre-materialization meal pairing; resolved to slot_meal_anchor_id at commit.
    #[serde(default)]
    pub paired_meal_name: Option<String>,
```

Add a new request type near `PatchEntryRequest`:

```rust
/// Body for `PATCH /schedule/entries/{id}/position`. Exactly one of
/// `after_anchor` / `slot_meal_anchor_id` must be present.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct RepositionEntryRequest {
    pub date: NaiveDate,
    #[serde(default)]
    pub after_anchor: Option<String>,
    #[serde(default)]
    pub slot_meal_anchor_id: Option<Uuid>,
    pub position: i32,
}
```

- [ ] **Step 2: Map the new fields in `map_entry`**

In `plnd_api/src/routes/schedule.rs` `map_entry` (line 55), add the two fields to the returned `PlanEntryInput`:

```rust
    Ok(PlanEntryInput {
        date: e.date,
        task_type: e.task_type,
        title: e.title,
        scheduled_start: e.scheduled_start,
        after_anchor: e.after_anchor,
        duration_minutes: e
            .duration_minutes
            .map(|d| i32::try_from(d).map_err(|_| StatusCode::BAD_REQUEST))
            .transpose()?,
        energy_required: e.energy_required,
        one_shot: e.one_shot,
        slot_position: e.slot_position,
        paired_meal_name: e.paired_meal_name,
    })
```

- [ ] **Step 3: Write the failing validation unit test**

Add to the `tests` module in `plnd_api/src/routes/schedule.rs`:

```rust
#[test]
fn reposition_target_requires_exactly_one_slot_key() {
    use crate::models::RepositionEntryRequest;
    let neither = RepositionEntryRequest {
        date: date(2026, 1, 1), after_anchor: None, slot_meal_anchor_id: None, position: 0,
    };
    assert!(super::reposition_target(&neither).is_err());

    let both = RepositionEntryRequest {
        date: date(2026, 1, 1),
        after_anchor: Some("lunch".into()),
        slot_meal_anchor_id: Some(Uuid::new_v4()),
        position: 0,
    };
    assert!(super::reposition_target(&both).is_err());

    let ok_anchor = RepositionEntryRequest {
        date: date(2026, 1, 1), after_anchor: Some("lunch".into()),
        slot_meal_anchor_id: None, position: 1,
    };
    assert!(super::reposition_target(&ok_anchor).is_ok());
}
```

- [ ] **Step 4: Run it to confirm failure**

Run: `just verify rust`
Expected: FAIL to compile — `reposition_target` / handler not defined.

- [ ] **Step 5: Implement the validation helper + handler**

In `plnd_api/src/routes/schedule.rs`, add `RepositionEntryRequest` to the `crate::models` import (line 6-9) and `SlotTarget` to the `plnd_data` import (line 21-23: `use plnd_data::repository::schedule::SlotTarget;`). Add the helper + handler after `patch_entry` (line 433):

```rust
/// Resolve the request's polymorphic slot key into a `SlotTarget`. Exactly one
/// of `after_anchor` / `slot_meal_anchor_id` must be set.
fn reposition_target(req: &RepositionEntryRequest) -> Result<SlotTarget, StatusCode> {
    match (&req.after_anchor, req.slot_meal_anchor_id) {
        (Some(a), None) if !a.trim().is_empty() => Ok(SlotTarget::AfterAnchor(a.clone())),
        (None, Some(m)) => Ok(SlotTarget::MealAnchor(m)),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

#[utoipa::path(
    patch,
    path = "/schedule/entries/{id}/position",
    tag = "Schedule",
    params(("id" = Uuid, Path, description = "Schedule entry ID")),
    request_body = RepositionEntryRequest,
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Entry repositioned"),
        (status = 400, description = "Zero or both slot keys"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entry not found"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %claims.sub))]
pub async fn reposition_entry(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(entry_id): Path<Uuid>,
    Json(body): Json<RepositionEntryRequest>,
) -> Result<StatusCode, StatusCode> {
    let target = reposition_target(&body)?;
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .repos
        .schedule
        .reposition_entry(user_id, entry_id, body.date, &target, body.position)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|e| match e {
            Error::NotFound => StatusCode::NOT_FOUND,
            _ => {
                tracing::error!(error = %e, "reposition_entry error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })
}
```

Add the import of `Uuid` to the test module if missing (`use uuid::Uuid;` already present at top of file).

- [ ] **Step 6: Register the route**

In `plnd_api/src/main.rs`, after the `/schedule/entries/{id}` route (line 385):

```rust
        .route("/schedule/entries/{id}", patch(schedule::patch_entry))
        .route(
            "/schedule/entries/{id}/position",
            patch(schedule::reposition_entry),
        )
```

- [ ] **Step 7: Update every `PlanEntryRequest { .. }` literal in the route tests**

The `base_entry()` helper and inline `PlanEntryRequest` literals (lines 448-510) need `slot_position: None, paired_meal_name: None,`. Add them to `base_entry()`:

```rust
    fn base_entry() -> PlanEntryRequest {
        PlanEntryRequest {
            date: date(2026, 1, 1),
            task_type: Some("work".into()),
            title: Some("Test".into()),
            scheduled_start: None,
            after_anchor: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: None,
            slot_position: None,
            paired_meal_name: None,
        }
    }
```

Add the same two fields to the other inline literals in that test module.

- [ ] **Step 8: Run the suite**

Run: `just fmt && just verify rust`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add plnd_api/src/models.rs plnd_api/src/routes/schedule.rs plnd_api/src/main.rs
git commit -m "feat(api): add reposition endpoint and slot_position/paired_meal_name plumbing"
```

### Task 6: Phase 1 verification gate

- [ ] **Step 1: Full verify**

Run: `just fmt && just verify > /tmp/verify-p1.log 2>&1`
Then read `/tmp/verify-p1.log` and confirm it ends with `✅ All verifications passed`.
Expected: PASS. If the migrations don't re-embed, touch a `plnd_data` source file (e.g. add a newline to `plnd_data/src/lib.rs`) and re-run.

- [ ] **Step 2: Open the Phase 1 PR**

```bash
git fetch origin && git rebase origin/main
ls plnd_data/migrations/ | grep -E '005[23]'   # confirm no number collision
git push --force-with-lease -u origin <branch>
gh pr create --base main --title "feat(schedule): slot_position foundation for drag-reordering" \
  --body "Phase 1 of task drag-reordering (spec: docs/superpowers/specs/2026-06-22-task-drag-reordering-design.md). Adds slot_position, read ordering, reposition_entry + endpoint, and commit-payload plumbing. No UI yet."
```

Then invoke the `monitor-pr` skill.

---

## Phase 2 — Day-view drag-and-drop (live)

Files in play:
- `plnd_client/package.json` (add `@angular/cdk`)
- `plnd_client/src/app/core/utils/schedule-assembly.ts` (modify — grouped output)
- `plnd_client/src/app/core/models/schedule.ts` (modify — `SlotGroup` type)
- `plnd_client/src/app/core/services/schedule.service.ts` (modify — reposition call + optimistic state)
- `plnd_client/src/app/features/day-view/day-view.ts` (modify — drop lists + handler)
- `plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts` (modify — during-meal drop list)

> Before editing each frontend file, read it in full first — exact template structure isn't reproduced here. The code blocks below are the new logic to integrate.

### Task 7: Add `@angular/cdk` and verify a baseline drop list

**Files:**
- Modify: `plnd_client/package.json`
- Modify: `plnd_client/src/app/features/day-view/day-view.ts` (imports)

**Interfaces:**
- Produces: `DragDropModule` importable in standalone components; `@angular/cdk` pinned to the Angular 22 line.

- [ ] **Step 1: Install the CDK at the matching major**

Run (from the worktree's `plnd_client/`):
```bash
npx ng add @angular/cdk --skip-confirmation
```
If `ng add` is undesirable, instead: `npm install @angular/cdk@^22`. Confirm `package.json` lists `@angular/cdk` at `^22` (matching `@angular/core`).

- [ ] **Step 2: Verify the dependency builds**

Run: `npx ng build --configuration development` (or `just verify ts`)
Expected: build succeeds with the new dependency.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/package.json plnd_client/package-lock.json
git commit -m "build(client): add @angular/cdk for drag-and-drop"
```

### Task 8: Assembly emits droppable `SlotGroup`s

**Files:**
- Modify: `plnd_client/src/app/core/models/schedule.ts` (new `SlotGroup`)
- Modify: `plnd_client/src/app/core/utils/schedule-assembly.ts`
- Test: `plnd_client/src/app/core/utils/schedule-assembly.spec.ts` (existing — update)

**Interfaces:**
- Consumes: existing `ScheduleAnchorDto`, `ScheduleEntryDto`, `PlannedMealEntryDto`.
- Produces:
  ```ts
  export type SlotKey = { afterAnchor: string } | { mealAnchorId: string };
  export interface SlotGroup {
    anchor: MealAnchor | ScheduleTask | null; // null = start-of-day boundary
    slotKey: { afterAnchor: string };         // the slot after this anchor
    tasks: ScheduleTask[];                     // ordered by arrival (= slot_position)
  }
  export interface AssembledDay { items: ScheduleItem[]; slotByLabel: Map<string, ScheduleTask[]>; }
  ```
  Final shape decided below: `assembleScheduleItems` keeps returning `ScheduleItem[]` for backward compatibility but each `MealAnchor` exposes its `duringMealTasks` (already present) and a new sibling export `assembleSlotGroups(anchors, entries, plannedMeals): SlotGroup[]` provides the droppable structure the day-view template iterates.

- [ ] **Step 1: Add the `SlotGroup` types**

In `plnd_client/src/app/core/models/schedule.ts`, add:

```ts
/** A droppable slot: the floating tasks that live after `anchorLabel`. */
export interface SlotGroup {
  /** Lower-anchor label, lowercased — the after_anchor value tasks here carry. */
  anchorLabel: string;
  /** The rendered anchor row that opens this slot (null for start-of-day). */
  anchor: import('./schedule').MealAnchor | ScheduleTask | null;
  tasks: ScheduleTask[];
}
```

- [ ] **Step 2: Write the failing test**

In `schedule-assembly.spec.ts`, add (adapt imports to the existing spec):

```ts
it('groups floating tasks into slots after their anchor, in arrival order', () => {
  const anchors = [
    { kind: 'start_of_day', sequence: 0, time: '06:00:00', label: 'start of day', id: null,
      status: null, consumed_at: null, tolerance_minutes: null, sort_order: null,
      template_entry_id: null, zone: null },
    { kind: 'meal', sequence: 1, time: '12:00:00', label: 'lunch', id: 'meal-1',
      status: 'planned', consumed_at: null, tolerance_minutes: 60, sort_order: 0,
      template_entry_id: null, zone: null },
  ] as any;
  const entries = [
    { entry_id: 't1', task_type: 'work', title: 'first', date: '2026-06-22',
      after_anchor: 'lunch' },
    { entry_id: 't2', task_type: 'work', title: 'second', date: '2026-06-22',
      after_anchor: 'lunch' },
  ] as any;

  const groups = assembleSlotGroups(anchors, entries, []);
  const lunch = groups.find(g => g.anchorLabel === 'lunch')!;
  expect(lunch.tasks.map(t => t.label)).toEqual(['first', 'second']);
});
```

- [ ] **Step 3: Run it to confirm failure**

Run (from `plnd_client/`): `npx ng test --watch=false --include='**/schedule-assembly.spec.ts'`
Expected: FAIL — `assembleSlotGroups` undefined.

- [ ] **Step 4: Implement `assembleSlotGroups`**

In `schedule-assembly.ts`, add (reusing the existing partition logic). It walks anchors and, for each, collects the floating tasks whose `after_anchor` matches the anchor label, in the order they appear in `entries` (which the backend now sorts by `slot_position`):

```ts
import { SlotGroup } from '../models/schedule';

export function assembleSlotGroups(
  anchors: ScheduleAnchorDto[],
  entries: ScheduleEntryDto[],
  plannedMeals: PlannedMealEntryDto[],
): SlotGroup[] {
  // Reuse the same partitioning as assembleScheduleItems for floating tasks.
  const floatingByLabel = new Map<string, ScheduleTask[]>();
  for (const e of entries) {
    if (e.slot_meal_anchor_id) continue;       // paired — handled by meal rows
    if (e.scheduled_start) continue;            // scheduled — is an anchor
    if (!e.after_anchor) continue;              // orphan — handled defensively elsewhere
    const key = e.after_anchor.toLowerCase();
    const list = floatingByLabel.get(key) ?? [];
    list.push(mapEntry(e));
    floatingByLabel.set(key, list);
  }

  const mealByAnchor = new Map<string, PlannedMealEntryDto>(
    (plannedMeals ?? []).map(pm => [pm.meal_anchor_instance_id, pm]),
  );

  const groups: SlotGroup[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const label = a.label.toLowerCase();
    if (seen.has(label)) continue;
    seen.add(label);
    let anchor: SlotGroup['anchor'] = null;
    if (a.kind === 'meal' && a.id) {
      anchor = mapAnchorInstance(a, mealByAnchor.get(a.id), []);
    }
    groups.push({ anchorLabel: label, anchor, tasks: floatingByLabel.get(label) ?? [] });
  }
  return groups;
}
```

(`mapEntry` and `mapAnchorInstance` are the existing private functions — export them or keep `assembleSlotGroups` in the same module so they're in scope. Keep it in the same file.)

- [ ] **Step 5: Run the test**

Run: `npx ng test --watch=false --include='**/schedule-assembly.spec.ts'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/core/models/schedule.ts \
        plnd_client/src/app/core/utils/schedule-assembly.ts \
        plnd_client/src/app/core/utils/schedule-assembly.spec.ts
git commit -m "feat(day-view): assemble droppable slot groups"
```

### Task 9: Day-view drop lists + reposition service call

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.ts`
- Modify: `plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts`
- Test: `plnd_client/src/app/features/day-view/day-view.spec.ts`

**Interfaces:**
- Consumes: `assembleSlotGroups` (Task 8); `PATCH /schedule/entries/{id}/position` (Task 5).
- Produces: `ScheduleService.repositionTask(entryId, date, target, position)` returning `Observable<void>`, with optimistic local update + rollback.

- [ ] **Step 1: Add the reposition HTTP method to the service**

In `schedule.service.ts`:

```ts
type RepositionTarget = { afterAnchor: string } | { mealAnchorId: string };

repositionTask(entryId: string, date: string, target: RepositionTarget, position: number) {
  const body: Record<string, unknown> = { date, position };
  if ('afterAnchor' in target) body['after_anchor'] = target.afterAnchor;
  else body['slot_meal_anchor_id'] = target.mealAnchorId;
  return this.http.patch<void>(`${this.apiBase}/schedule/entries/${entryId}/position`, body);
}
```

- [ ] **Step 2: Write the failing test (drop handler updates state + calls API)**

In `day-view.spec.ts` (use `provideHttpClient` + `provideHttpClientTesting`, per the project's test-module rule), assert that dispatching a CDK drop within a slot reorders the local slot signal and issues a PATCH. Drive it through a real `CdkDragDrop` event object:

```ts
it('reorders within a slot and persists via PATCH', () => {
  // ...component setup with two floating "lunch" tasks t1,t2...
  const drop = {
    previousIndex: 0, currentIndex: 1,
    container: { id: 'slot-lunch', data: component.slotTasks('lunch') },
    previousContainer: { id: 'slot-lunch', data: component.slotTasks('lunch') },
    item: { data: { id: 't1' } },
  } as unknown as CdkDragDrop<ScheduleTask[]>;

  component.onSlotDrop(drop, 'lunch');

  expect(component.slotTasks('lunch').map(t => t.id)).toEqual(['t2', 't1']);
  const req = httpMock.expectOne(r => r.url.endsWith('/schedule/entries/t1/position'));
  expect(req.request.body).toEqual({ date: component.date(), after_anchor: 'lunch', position: 1 });
  req.flush(null);
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `npx ng test --watch=false --include='**/day-view.spec.ts'`
Expected: FAIL — `onSlotDrop` / `slotTasks` not defined.

- [ ] **Step 4: Implement the drop handlers**

In `day-view.ts`, hold slot tasks in a signal keyed by label, build it from `assembleSlotGroups`, and implement drop handlers using CDK helpers:

```ts
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';

// Within a slot:
onSlotDrop(event: CdkDragDrop<ScheduleTask[]>, anchorLabel: string): void {
  const tasks = event.container.data;
  if (event.previousContainer === event.container) {
    moveItemInArray(tasks, event.previousIndex, event.currentIndex);
  } else {
    transferArrayItem(event.previousContainer.data, tasks, event.previousIndex, event.currentIndex);
  }
  const moved = tasks[event.currentIndex];
  this.persistReposition(moved.id, { afterAnchor: anchorLabel }, event.currentIndex,
                         event.previousContainer.data, event.previousIndex);
}

// Into / out of a meal's during-meal list:
onMealDrop(event: CdkDragDrop<ScheduleTask[]>, mealAnchorId: string): void {
  const tasks = event.container.data;
  if (event.previousContainer === event.container) {
    moveItemInArray(tasks, event.previousIndex, event.currentIndex);
  } else {
    transferArrayItem(event.previousContainer.data, tasks, event.previousIndex, event.currentIndex);
  }
  const moved = tasks[event.currentIndex];
  this.persistReposition(moved.id, { mealAnchorId }, event.currentIndex,
                         event.previousContainer.data, event.previousIndex);
}

private persistReposition(
  entryId: string, target: RepositionTarget, position: number,
  prevList: ScheduleTask[], prevIndex: number,
): void {
  this.schedule.repositionTask(entryId, this.date(), target, position).subscribe({
    error: () => {
      // Roll back the optimistic move and surface a toast.
      this.reloadDay();              // simplest correct rollback: re-fetch authoritative state
      this.toast.error('Could not move task — please try again.');
    },
  });
}
```

Add `DragDropModule` to the component `imports`. In the template, wrap each slot's task list in `<div cdkDropList [cdkDropListData]="slotTasks(label)" [cdkDropListConnectedTo]="allDropListIds()" (cdkDropListDropped)="onSlotDrop($event, label)">` with `cdkDrag` on each task row, and the meal's during-meal list similarly bound to `onMealDrop`. Connect all lists (slots + meals) so tasks transfer freely.

- [ ] **Step 5: Run the test**

Run: `npx ng test --watch=false --include='**/day-view.spec.ts'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/features/day-view/ \
        plnd_client/src/app/core/services/schedule.service.ts \
        plnd_client/src/app/features/schedule/components/meal-row/meal-row.ts
git commit -m "feat(day-view): drag-reorder tasks within/between slots and meal pairings"
```

### Task 10: Day-view e2e + Phase 2 gate

**Files:**
- Create: `plnd_client/e2e/day-view-drag.spec.ts`

- [ ] **Step 1: Write the e2e drag test**

Using the real-backend helpers (`seedAuth`, `seedScheduleEntries`), seed two floating "lunch" tasks, drag the second above the first with `mcp`-free Playwright `dragTo`, reload, and assert order persisted:

```ts
test('reordering a slot survives reload', async ({ page }) => {
  await seedAuth(page);
  await seedScheduleEntries(page, /* two floating lunch tasks t1 then t2 */);
  await page.goto('/day');
  const first = page.getByTestId('task-row').first();
  const second = page.getByTestId('task-row').nth(1);
  await second.dragTo(first);
  await page.reload();
  await expect(page.getByTestId('task-row').first()).toContainText(/* second task title */);
});
```

- [ ] **Step 2: Run e2e**

Run: `just verify e2e > /tmp/verify-p2.log 2>&1`, then read the log and confirm the pass line.
Expected: PASS. (If infra isn't up, notify the user — do not run `just persist`.)

- [ ] **Step 3: Full verify, commit, PR**

Run: `just fmt && just verify > /tmp/verify-p2-all.log 2>&1`; confirm the pass line.

```bash
git add plnd_client/e2e/day-view-drag.spec.ts
git commit -m "test(day-view): e2e drag-reorder persistence"
git fetch origin && git rebase origin/main
git push --force-with-lease -u origin <branch>
gh pr create --base main --title "feat(day-view): drag-reorder tasks" --body "Phase 2 of task drag-reordering."
```

Then invoke `monitor-pr`.

---

## Phase 3 — Planning-wizard drag-and-drop (drafts)

Files in play:
- `plnd_client/src/app/core/models/week-plan.ts` (modify — `PlaceTasksEntry`, `PlannedTask`, `PlanEntryRequest`)
- `plnd_client/src/app/core/services/week-plan.service.ts` (modify — reorder + commit derivation)
- `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts` (modify — drop lists)
- `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts` (modify — drop lists + commit mapping)

### Task 11: Thread `slot_position` + `paired_meal_name` through the commit models

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts` (`PlanEntryRequest` ~line 169, `PlaceTasksEntry` ~203, `PlannedTask` ~92)
- Test: covered by Tasks 12/13 commit-derivation specs.

**Interfaces:**
- Produces: `PlanEntryRequest.slot_position?: number`, `PlanEntryRequest.paired_meal_name?: string`; `PlannedTask` and `PlaceTasksEntry` gain an optional `paired_meal_name?: string` (their array index supplies `slot_position`).

- [ ] **Step 1: Extend the TS interfaces**

In `week-plan.ts`, add to `PlanEntryRequest`:

```ts
  one_shot?: boolean;
  /** 0-based order within (date, slot). */
  slot_position?: number;
  /** Pre-materialization meal pairing, resolved to slot_meal_anchor_id at commit. */
  paired_meal_name?: string;
```

Add `paired_meal_name?: string;` to `PlaceTasksEntry` and `PlannedTask`.

- [ ] **Step 2: Verify build**

Run: `just verify ts`
Expected: PASS (additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts
git commit -m "feat(planning): add slot_position/paired_meal_name to commit models"
```

### Task 12: Weekly day-grid drag (reorder, cross-day, in/out of meal) + commit derivation

**Files:**
- Modify: `plnd_client/src/app/core/services/week-plan.service.ts`
- Modify: `plnd_client/src/app/features/planning/steps/plan-day-grid-step/plan-day-card.ts`
- Test: `plnd_client/src/app/core/services/week-plan.service.spec.ts`

**Interfaces:**
- Consumes: `WeekPlanService.scheduledTasks` signal; `buildCommitRequest` (line ~398).
- Produces: `WeekPlanService.reorderTask(...)` / `moveTaskToDay(...)` mutators; `buildCommitRequest` emits `slot_position` per `(date, slot)` and `paired_meal_name` for paired tasks.

- [ ] **Step 1: Write the failing commit-derivation test**

In `week-plan.service.spec.ts`:

```ts
it('derives contiguous slot_position per (date, slot) at commit', () => {
  service.addTask({ date: '2026-06-22', title: 'a', energy: 'low', after_anchor: 'lunch' } as any);
  service.addTask({ date: '2026-06-22', title: 'b', energy: 'low', after_anchor: 'lunch' } as any);
  service.addTask({ date: '2026-06-22', title: 'c', energy: 'low', after_anchor: 'dinner' } as any);

  const req = (service as any).buildCommitRequest('task-1', false);
  const lunch = req.entries.filter((e: any) => e.after_anchor === 'lunch');
  expect(lunch.map((e: any) => e.slot_position)).toEqual([0, 1]);
  const dinner = req.entries.filter((e: any) => e.after_anchor === 'dinner');
  expect(dinner.map((e: any) => e.slot_position)).toEqual([0]);
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx ng test --watch=false --include='**/week-plan.service.spec.ts'`
Expected: FAIL — `slot_position` undefined on emitted entries.

- [ ] **Step 3: Derive `slot_position` in `buildCommitRequest`**

In `week-plan.service.ts` `buildCommitRequest` (the `for (const task of tasks)` loop ~line 430), compute a per-`(date, slot)` running index. The slot key is `paired_meal_name ?? after_anchor ?? '<scheduled>'`:

```ts
const posByGroup = new Map<string, number>();
for (const task of tasks) {
  const type = (task.task_type as string) === 'custom' ? 'general' : (task.task_type ?? 'general');
  const slotKey = `${task.date}::${task.paired_meal_name ?? task.after_anchor ?? '<sched>'}`;
  const pos = posByGroup.get(slotKey) ?? 0;
  posByGroup.set(slotKey, pos + 1);
  entries.push({
    date: task.date,
    task_type: type as TaskType,
    title: task.title,
    scheduled_start: task.after_anchor || task.paired_meal_name ? null : (task.scheduled_start ?? '09:00'),
    after_anchor: task.paired_meal_name ? undefined : task.after_anchor,
    paired_meal_name: task.paired_meal_name,
    slot_position: pos,
  });
}
```

- [ ] **Step 4: Add reorder/move mutators**

```ts
reorderTask(date: string, slotKey: string, fromIndex: number, toIndex: number): void {
  // Reorder within the array slice for (date, slotKey), preserving other tasks' order.
  this.scheduledTasksSignal.update(all => reorderWithinSlot(all, date, slotKey, fromIndex, toIndex));
}
moveTaskToDay(task: PlannedTask, newDate: string): void {
  this.scheduledTasksSignal.update(all => all.map(t => t === task ? { ...t, date: newDate } : t));
}
```

(`reorderWithinSlot` is a small pure helper — implement it in the same file and unit-test it.)

- [ ] **Step 5: Wire CDK drop lists in `plan-day-card.ts`**

Add `DragDropModule`; render each `(date, slot)` task list as a connected `cdkDropList`; connect lists across day cards (cross-day) and to each meal's pairing list (in/out of meal). On drop, call `reorderTask` / `moveTaskToDay`, and set/clear `paired_meal_name` when crossing into/out of a meal list.

- [ ] **Step 6: Run the tests**

Run: `npx ng test --watch=false --include='**/week-plan.service.spec.ts'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/core/services/week-plan.service.ts \
        plnd_client/src/app/features/planning/steps/plan-day-grid-step/
git commit -m "feat(planning): drag-reorder weekly day-grid tasks with cross-day and meal pairing"
```

### Task 13: Onboarding placement-review drag + commit mapping

**Files:**
- Modify: `plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/task-placement-review-substep.ts`
- Test: `.../task-placement-review-substep.spec.ts`

**Interfaces:**
- Consumes: `entries` signal of `PlaceTasksEntry[]` (line ~643); `onSaveAndReturn` mapping (line ~795).
- Produces: drag reorder within/between buckets, cross-day, into/out of meal dividers; `onSaveAndReturn` maps each entry to `PlanEntryRequest` with `slot_position` (per date+slot array index) and `paired_meal_name`.

- [ ] **Step 1: Write the failing test**

Assert that after reordering `entries`, `onSaveAndReturn` produces `placed` entries with contiguous `slot_position` per `(scheduled_date, after_anchor)` and that a task dropped on a meal divider carries `paired_meal_name`:

```ts
it('maps reordered placements to contiguous slot_position and paired_meal_name', () => {
  component.entries.set([
    { title: 'a', scheduled_date: '2026-06-22', task_type: 'work', duration_minutes: 30,
      energy_required: 'low', after_anchor: 'lunch' },
    { title: 'b', scheduled_date: '2026-06-22', task_type: 'work', duration_minutes: 30,
      energy_required: 'low', after_anchor: 'lunch' },
    { title: 'c', scheduled_date: '2026-06-22', task_type: 'medication', duration_minutes: 5,
      energy_required: 'low', paired_meal_name: 'breakfast' },
  ] as any);
  const planEntries = component.toPlanEntries();   // extract mapping into a testable method
  const lunch = planEntries.filter(e => e.after_anchor === 'lunch');
  expect(lunch.map(e => e.slot_position)).toEqual([0, 1]);
  expect(planEntries.find(e => e.paired_meal_name === 'breakfast')?.slot_position).toBe(0);
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx ng test --watch=false --include='**/task-placement-review-substep.spec.ts'`
Expected: FAIL — `toPlanEntries` / `slot_position` mapping absent.

- [ ] **Step 3: Extract + extend the mapping**

Refactor the `onSaveAndReturn` mapping (line ~796-807) into a testable `toPlanEntries(): PlanEntryRequest[]` that derives `slot_position` per `(scheduled_date, slot)` exactly as Task 12 does, and passes `paired_meal_name` through:

```ts
toPlanEntries(): PlanEntryRequest[] {
  const posByGroup = new Map<string, number>();
  return this.entries().map(entry => {
    const slotKey = `${entry.scheduled_date}::${entry.paired_meal_name ?? entry.after_anchor ?? '<sched>'}`;
    const pos = posByGroup.get(slotKey) ?? 0;
    posByGroup.set(slotKey, pos + 1);
    return {
      date: entry.scheduled_date,
      task_type: entry.task_type,
      title: entry.title,
      scheduled_start: entry.after_anchor || entry.paired_meal_name ? null : (entry.time_window_start ?? null),
      after_anchor: entry.paired_meal_name ? undefined : entry.after_anchor,
      paired_meal_name: entry.paired_meal_name,
      duration_minutes: entry.duration_minutes,
      energy_required: entry.energy_required,
      slot_position: pos,
    };
  });
}
```

Update `onSaveAndReturn` to call `this.toPlanEntries()`.

- [ ] **Step 4: Wire CDK drop lists**

Add `DragDropModule`; make each bucket's task list and each meal divider a connected `cdkDropList` across day cards; on drop, reorder the `entries` signal, update `scheduled_date` for cross-day, and set/clear `paired_meal_name` for meal dividers.

- [ ] **Step 5: Run the tests**

Run: `npx ng test --watch=false --include='**/task-placement-review-substep.spec.ts'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plnd_client/src/app/features/onboarding/tasks/substeps/task-placement-review-substep/
git commit -m "feat(onboarding): drag-reorder placement review with cross-day and meal pairing"
```

### Task 14: Wizard e2e, follow-up issue, Phase 3 gate

**Files:**
- Create: `plnd_client/e2e/planning-drag.spec.ts`, `plnd_client/e2e/onboarding-placement-drag.spec.ts`

- [ ] **Step 1: Write e2e for both wizards**

Drag a task to another day and into a meal, complete the wizard, then load the day view and assert the committed order/pairing persisted (real backend).

- [ ] **Step 2: Open the a11y follow-up issue**

```bash
gh issue create --title "Keyboard/button reorder path for tasks (drag-only is v1)" \
  --body "Task drag-reordering (spec 2026-06-22) shipped pointer-drag only. Add a non-drag reorder affordance (move up/down buttons or keyboard arrows on a focused task) across the day view and both planning wizards, for motor accessibility. See docs/superpowers/specs/2026-06-22-task-drag-reordering-design.md §Follow-up."
```

- [ ] **Step 3: Full verify**

Run: `just fmt && just verify > /tmp/verify-p3.log 2>&1`; read the log and confirm the pass line.

- [ ] **Step 4: Commit, rebase, PR**

```bash
git add plnd_client/e2e/planning-drag.spec.ts plnd_client/e2e/onboarding-placement-drag.spec.ts
git commit -m "test(planning): e2e drag-reorder across both wizards"
git fetch origin && git rebase origin/main
git push --force-with-lease -u origin <branch>
gh pr create --base main --title "feat(planning): drag-reorder tasks in both wizards" --body "Phase 3 of task drag-reordering. Closes the feature; a11y keyboard path tracked in the follow-up issue."
```

Then invoke `monitor-pr`.

---

## Self-Review

**Spec coverage:**
- §A data model → Task 1 (column + constraints + field). ✓
- §B read ordering → Task 2. ✓
- §C reposition op → Tasks 4 (repo) + 5 (endpoint). ✓
- §D commit path (`slot_position`, `paired_meal_name` resolution) → Tasks 3 + 5 + 11. ✓
- §E assembly slot groups → Task 8. ✓
- §F drag wiring (day view + wizards) → Tasks 7, 9, 12, 13. ✓
- §G error handling (optimistic rollback; deferred-constraint commit failure) → Task 9 (rollback) + Task 3 (constraint behavior). ✓
- §H testing (Rust integration, Angular unit, Playwright e2e) → Tasks 3-5, 8-9, 12-13 (unit/integration), 10, 14 (e2e). ✓
- §I phasing → three phases with PR gates (Tasks 6, 10, 14). ✓
- §Follow-up a11y issue → Task 14. ✓

**Type consistency:** `slot_position` is `i32` in Rust (`ScheduleEntry`, `PlanEntryInput`, `RepositionEntryRequest`) and `number`/`slot_position` in TS (`PlanEntryRequest`); `SlotTarget { AfterAnchor(String), MealAnchor(Uuid) }` is used identically in the db fn, trait, pg impl, and the API handler's `reposition_target`. `reposition_entry` signature `(user_id, entry_id, date, &SlotTarget, position)` matches across db/trait/impl/handler. The TS `RepositionTarget` (`{ afterAnchor } | { mealAnchorId }`) maps to the request body fields `after_anchor` / `slot_meal_anchor_id` consistently in Task 9 and Task 5.

**Placeholder scan:** Frontend template-wiring steps point to "read the file first" and give the exact new logic rather than fabricated line numbers — deliberate, since the templates weren't read verbatim. All test code and all backend code blocks are complete.

**Coupling note:** Task 1 adds the deferred constraints; Task 3 populates `slot_position` on commit. They ship in the **same PR (Phase 1)** — a commit of two+ floating tasks in one slot would violate the constraint without Task 3's population, which Task 3's `commit_plan_persists_distinct_slot_positions_in_one_slot` test proves.
