# Unified `/schedule/anchors` Response — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /schedule/anchors` return one ordered sequence of *all four* anchor sources (meal instances, scheduled tasks, start/end-of-day, in-day timezone changes) instead of meal instances only.

**Architecture:** A new pure function `assemble_day_anchors` in `plnd_api/src/anchors.rs` merges the four sources fetched via existing repositories and orders them with a minutes-since-wake projection (so midnight-crossing day types linearize correctly). The route fetches inputs and calls it; no `plnd_data` change. The frontend gets the minimum change to stay green (filter `kind === 'meal'`); the real day-view slot rendering is issue #959.

**Tech Stack:** Rust / Axum / utoipa (backend), Angular / RxJS / Jasmine (frontend). Design spec: `docs/superpowers/specs/2026-06-16-unified-schedule-anchors-design.md`.

---

## File Structure

- **Create** `plnd_api/src/anchors.rs` — pure assembly + ordering, with unit tests. One responsibility: turn the four source vectors into an ordered `Vec<ScheduleAnchorResponse>`.
- **Modify** `plnd_api/src/lib.rs` — register `pub mod anchors;`.
- **Modify** `plnd_api/src/api_response.rs` — add `ScheduleAnchorKind` + `ScheduleAnchorResponse`.
- **Modify** `plnd_api/src/openapi.rs` — register the two new schemas.
- **Modify** `plnd_api/src/routes/schedule_anchors.rs` — rewrite `list_for_date` to fetch all sources and assemble; update its `#[utoipa::path]` body.
- **Create** `plnd_api/tests/schedule_anchors_test.rs` — serde tests for the response type.
- **Modify** `plnd_client/src/app/core/models/week-plan.ts` — add `ScheduleAnchorKind` + `ScheduleAnchorDto`.
- **Modify** `plnd_client/src/app/core/services/schedule.service.ts` — consume the unified DTO, filter `kind === 'meal'`.
- **Modify** `plnd_client/src/app/core/services/schedule.service.spec.ts` — update the `anchorDto` helper to the unified shape; add a non-meal-ignored test.

**Testing reality (read before Task 1):** `plnd_api/tests/*.rs` are pure serde/logic tests — there is **no** live-HTTP/DB app harness in this repo, and DB tests use `#[sqlx::test]` inside `plnd_data/src/db/`. Therefore the substantive coverage for this feature is the **`assemble_day_anchors` unit tests** (Task 2), which integrate all four sources together. The wired endpoint is exercised end-to-end by the existing day-view e2e (which calls `/schedule/anchors`) — kept green by Task 4. This is the faithful mapping of the spec's "unit + integration" acceptance onto this codebase's test layers.

---

## Task 1: Unified response types

**Files:**
- Modify: `plnd_api/src/api_response.rs` (add after `MealAnchorInstanceResponse`, ends at line 116)
- Modify: `plnd_api/src/openapi.rs:208` (schemas list)
- Test: `plnd_api/tests/schedule_anchors_test.rs` (create)

- [ ] **Step 1: Write the failing serde test**

Create `plnd_api/tests/schedule_anchors_test.rs`:

```rust
use chrono::NaiveTime;
use plnd_api::api_response::{ScheduleAnchorKind, ScheduleAnchorResponse};

fn t(s: &str) -> NaiveTime {
    NaiveTime::parse_from_str(s, "%H:%M:%S").unwrap()
}

#[test]
fn kind_serializes_snake_case() {
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::ScheduledTask).unwrap(),
        "\"scheduled_task\""
    );
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::StartOfDay).unwrap(),
        "\"start_of_day\""
    );
    assert_eq!(
        serde_json::to_string(&ScheduleAnchorKind::TimezoneChange).unwrap(),
        "\"timezone_change\""
    );
}

#[test]
fn start_of_day_response_serializes_null_meal_fields() {
    let resp = ScheduleAnchorResponse {
        kind: ScheduleAnchorKind::StartOfDay,
        sequence: 0,
        time: t("07:00:00"),
        label: "start of day".to_string(),
        id: None,
        status: None,
        consumed_at: None,
        tolerance_minutes: None,
        sort_order: None,
        template_entry_id: None,
        zone: None,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"start_of_day\""));
    assert!(json.contains("\"sequence\":0"));
    assert!(json.contains("\"id\":null"));
    assert!(json.contains("\"status\":null"));
    assert!(json.contains("\"zone\":null"));
}

#[test]
fn meal_response_carries_meal_fields() {
    let resp = ScheduleAnchorResponse {
        kind: ScheduleAnchorKind::Meal,
        sequence: 1,
        time: t("08:00:00"),
        label: "Breakfast".to_string(),
        id: Some(uuid::Uuid::nil()),
        status: Some("planned".to_string()),
        consumed_at: None,
        tolerance_minutes: Some(60),
        sort_order: Some(0),
        template_entry_id: None,
        zone: None,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"kind\":\"meal\""));
    assert!(json.contains("\"status\":\"planned\""));
    assert!(json.contains("\"tolerance_minutes\":60"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p plnd_api --test schedule_anchors_test 2>&1 | head -30`
Expected: FAIL — `unresolved import plnd_api::api_response::ScheduleAnchorKind`.

- [ ] **Step 3: Add the types**

In `plnd_api/src/api_response.rs`, insert after the `impl From<plnd_data::models::MealAnchorInstance> for MealAnchorInstanceResponse` block (after line 116):

```rust
/// Discriminator for [`ScheduleAnchorResponse`] (#958). Snake-case on the wire,
/// matching `TimezoneSource` / `DeviceAffirmOutcome`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleAnchorKind {
    Meal,
    ScheduledTask,
    StartOfDay,
    EndOfDay,
    TimezoneChange,
}

/// One anchor in the unified, ordered `/schedule/anchors` sequence (§4.7).
///
/// `sequence` (not `time`) is the structural primitive (§4.8): consumers derive
/// slot adjacency from index `i`↔`i+1`. `time` is the resolved wall-clock value,
/// informational. Kind-specific fields are present-but-null on anchors they do
/// not apply to, matching this codebase's `Option` serialization convention.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ScheduleAnchorResponse {
    pub kind: ScheduleAnchorKind,
    /// 0-based position in the day's ordered sequence.
    pub sequence: i32,
    /// Resolved wall-clock time-of-day (informational; ordering uses `sequence`).
    pub time: NaiveTime,
    /// Stable label; matches the `after_anchor` convention
    /// ("start of day", "end of day", meal/task name, IANA zone name).
    pub label: String,
    /// `meal_anchor_instances.id` or `schedule_entries.entry_id`; null for
    /// start-of-day / end-of-day.
    pub id: Option<Uuid>,
    /// Meal only: "planned" | "consumed" | "skipped".
    pub status: Option<String>,
    /// Meal only.
    pub consumed_at: Option<DateTime<Utc>>,
    /// Meal only.
    pub tolerance_minutes: Option<i32>,
    /// Meal only.
    pub sort_order: Option<i32>,
    /// Meal only.
    pub template_entry_id: Option<Uuid>,
    /// Timezone-change only: IANA zone name (e.g. "America/Denver").
    pub zone: Option<String>,
}
```

(`NaiveTime`, `DateTime`, `Utc`, `Uuid`, `Serialize` are already imported at the top of `api_response.rs`.)

- [ ] **Step 4: Register the schemas in OpenAPI**

In `plnd_api/src/openapi.rs`, line 208 currently reads `        MealAnchorInstanceResponse,`. Add two lines after it:

```rust
        MealAnchorInstanceResponse,
        ScheduleAnchorResponse,
        ScheduleAnchorKind,
```

Then update the import on line 7 — add `ScheduleAnchorResponse, ScheduleAnchorKind` to the `use crate::api_response::{...}` list (alongside `MealAnchorInstanceResponse`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p plnd_api --test schedule_anchors_test 2>&1 | tail -15`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add plnd_api/src/api_response.rs plnd_api/src/openapi.rs plnd_api/tests/schedule_anchors_test.rs
git commit -m "feat(schedule): add unified ScheduleAnchorResponse type (#958)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure `assemble_day_anchors` + ordering

**Files:**
- Create: `plnd_api/src/anchors.rs`
- Modify: `plnd_api/src/lib.rs:4` (add `pub mod anchors;`)

This is the core of the feature. Tests are colocated in the module (`#[cfg(test)]`), no DB.

- [ ] **Step 1: Register the module**

In `plnd_api/src/lib.rs`, add `pub mod anchors;` immediately after line 4 (`pub mod api_response;`), keeping alphabetical-ish order:

```rust
pub mod anchors;
pub mod api_response;
```

- [ ] **Step 2: Write the module with a stub + the failing tests**

Create `plnd_api/src/anchors.rs`:

```rust
//! Unified day-anchor assembly (#958).
//!
//! Merges the four anchor sources (§4.7) — meal instances, scheduled tasks, the
//! implicit start/end-of-day, and in-day timezone changes — into one ordered
//! sequence. Ordering projects each anchor's wall-clock time onto a
//! minutes-since-wake axis so midnight-crossing day types (§4.3) linearize.
//! Pure and DB-free: the route fetches inputs via repositories and calls this.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use plnd_data::models::{DayType, MealAnchorInstance, ScheduleEntry, TimezoneAnchor};
use uuid::Uuid;

use crate::api_response::{ScheduleAnchorKind, ScheduleAnchorResponse};

/// Where an anchor is pinned in the sequence regardless of clock value.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pin {
    First, // start-of-day
    Mid,   // data anchors
    Last,  // end-of-day
}

/// Internal pre-ordering anchor.
struct Intermediate {
    kind: ScheduleAnchorKind,
    time: NaiveTime,
    label: String,
    id: Option<Uuid>,
    status: Option<String>,
    consumed_at: Option<DateTime<Utc>>,
    tolerance_minutes: Option<i32>,
    sort_order: Option<i32>,
    template_entry_id: Option<Uuid>,
    zone: Option<String>,
    pin: Pin,
}

/// Stable rank per kind for deterministic tie-breaking at equal offsets.
fn kind_rank(kind: ScheduleAnchorKind) -> u8 {
    match kind {
        ScheduleAnchorKind::StartOfDay => 0,
        ScheduleAnchorKind::Meal => 1,
        ScheduleAnchorKind::ScheduledTask => 2,
        ScheduleAnchorKind::TimezoneChange => 3,
        ScheduleAnchorKind::EndOfDay => 4,
    }
}

/// Total-order key: pinned-first/last bucket, then minutes-since-wake offset,
/// then a deterministic tie-break.
fn order_key(it: &Intermediate, wake: Option<NaiveTime>) -> (u8, i64, u8, i32, Uuid) {
    let pin_rank = match it.pin {
        Pin::First => 0,
        Pin::Mid => 1,
        Pin::Last => 2,
    };
    let offset = match wake {
        // (time − wake) wrapped into [0, 86400): linearizes wake→sleep even when
        // the day crosses midnight.
        Some(w) => (it.time - w).num_seconds().rem_euclid(86_400),
        // No active day type: no wake reference; fall back to raw clock.
        None => i64::from(it.time.num_seconds_from_midnight()),
    };
    (
        pin_rank,
        offset,
        kind_rank(it.kind),
        it.sort_order.unwrap_or(i32::MAX),
        it.id.unwrap_or_else(Uuid::nil),
    )
}

/// Assemble the four sources into one ordered sequence (§4.7).
///
/// `scheduled_tasks` should already be filtered to entries with a
/// `scheduled_start`; a guard skips any that slip through. Timezone anchors are
/// folded in only when they produce an in-day boundary (D3): effective on
/// `date` with a concrete `effective_time`.
pub fn assemble_day_anchors(
    meals: Vec<MealAnchorInstance>,
    scheduled_tasks: Vec<ScheduleEntry>,
    active_day_type: Option<DayType>,
    tz_anchors: Vec<TimezoneAnchor>,
    date: NaiveDate,
) -> Vec<ScheduleAnchorResponse> {
    let mut items: Vec<Intermediate> = Vec::new();

    // Start-of-day / end-of-day from the active day type (§4.3).
    if let Some(dt) = &active_day_type {
        items.push(Intermediate {
            kind: ScheduleAnchorKind::StartOfDay,
            time: dt.wake_time,
            label: "start of day".to_string(),
            id: None,
            status: None,
            consumed_at: None,
            tolerance_minutes: None,
            sort_order: None,
            template_entry_id: None,
            zone: None,
            pin: Pin::First,
        });
        items.push(Intermediate {
            kind: ScheduleAnchorKind::EndOfDay,
            time: dt.sleep_time,
            label: "end of day".to_string(),
            id: None,
            status: None,
            consumed_at: None,
            tolerance_minutes: None,
            sort_order: None,
            template_entry_id: None,
            zone: None,
            pin: Pin::Last,
        });
    }

    // Meal anchors.
    for m in meals {
        items.push(Intermediate {
            kind: ScheduleAnchorKind::Meal,
            time: m.preferred_time,
            label: m.name,
            id: Some(m.id),
            status: Some(m.status),
            consumed_at: m.consumed_at,
            tolerance_minutes: Some(m.tolerance_minutes),
            sort_order: Some(m.sort_order),
            template_entry_id: m.template_entry_id,
            zone: None,
            pin: Pin::Mid,
        });
    }

    // Scheduled tasks (a task with a fixed start time is an anchor, §4.7).
    for e in scheduled_tasks {
        let Some(start) = e.scheduled_start else {
            continue;
        };
        items.push(Intermediate {
            kind: ScheduleAnchorKind::ScheduledTask,
            time: start,
            label: e.title.unwrap_or_else(|| "(untitled)".to_string()),
            id: Some(e.entry_id),
            status: None,
            consumed_at: None,
            tolerance_minutes: None,
            sort_order: None,
            template_entry_id: None,
            zone: None,
            pin: Pin::Mid,
        });
    }

    // Timezone-change anchors — in-day boundaries only (D3).
    for a in tz_anchors {
        if a.effective_date == date
            && let Some(t) = a.effective_time
        {
            let zone = a.zone.name().to_string();
            items.push(Intermediate {
                kind: ScheduleAnchorKind::TimezoneChange,
                time: t,
                label: zone.clone(),
                id: Some(a.id),
                status: None,
                consumed_at: None,
                tolerance_minutes: None,
                sort_order: None,
                template_entry_id: None,
                zone: Some(zone),
                pin: Pin::Mid,
            });
        }
    }

    let wake = active_day_type.as_ref().map(|dt| dt.wake_time);
    items.sort_by(|x, y| order_key(x, wake).cmp(&order_key(y, wake)));

    items
        .into_iter()
        .enumerate()
        .map(|(i, it)| ScheduleAnchorResponse {
            kind: it.kind,
            sequence: i as i32,
            time: it.time,
            label: it.label,
            id: it.id,
            status: it.status,
            consumed_at: it.consumed_at,
            tolerance_minutes: it.tolerance_minutes,
            sort_order: it.sort_order,
            template_entry_id: it.template_entry_id,
            zone: it.zone,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn t(s: &str) -> NaiveTime {
        NaiveTime::parse_from_str(s, "%H:%M:%S").unwrap()
    }

    fn day_type(wake: &str, sleep: &str) -> DayType {
        DayType {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "Test".to_string(),
            days_bitmask: 0b1111111,
            wake_time: t(wake),
            sleep_time: t(sleep),
            is_cycle: false,
            cycle_length: None,
            anchor_date: None,
            cycle_bitmask: 0,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn meal(name: &str, time: &str, sort: i32) -> MealAnchorInstance {
        MealAnchorInstance {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            date: d(2026, 6, 16),
            name: name.to_string(),
            preferred_time: t(time),
            tolerance_minutes: 60,
            sort_order: sort,
            template_entry_id: None,
            status: "planned".to_string(),
            consumed_at: None,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
            updated_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn sched(title: &str, time: &str) -> ScheduleEntry {
        ScheduleEntry {
            entry_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            routine_id: None,
            task_type: "appointment".to_string(),
            title: Some(title.to_string()),
            date: d(2026, 6, 16),
            scheduled_start: Some(t(time)),
            scheduled_end: None,
            status: "pending".to_string(),
            actual_start: None,
            actual_end: None,
            after_anchor: None,
            slot_meal_anchor_id: None,
            deviation_note: None,
            duration_minutes: None,
            energy_required: None,
            one_shot: false,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
            updated_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn tz(date: NaiveDate, time: Option<&str>, zone: chrono_tz::Tz) -> TimezoneAnchor {
        TimezoneAnchor {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            effective_date: date,
            effective_time: time.map(t),
            zone,
            source: plnd_data::models::TimezoneSource::User,
            source_ref: None,
            inference_group: None,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
            updated_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn kinds(seq: &[ScheduleAnchorResponse]) -> Vec<ScheduleAnchorKind> {
        seq.iter().map(|a| a.kind).collect()
    }

    #[test]
    fn normal_day_orders_sod_meals_eod() {
        let dt = day_type("07:00:00", "22:00:00");
        let meals = vec![meal("Lunch", "12:00:00", 1), meal("Breakfast", "08:00:00", 0)];
        let out = assemble_day_anchors(meals, vec![], Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            kinds(&out),
            vec![
                ScheduleAnchorKind::StartOfDay,
                ScheduleAnchorKind::Meal,
                ScheduleAnchorKind::Meal,
                ScheduleAnchorKind::EndOfDay,
            ]
        );
        assert_eq!(out[1].label, "Breakfast");
        assert_eq!(out[2].label, "Lunch");
        // sequence is dense and 0-based.
        assert_eq!(out.iter().map(|a| a.sequence).collect::<Vec<_>>(), vec![0, 1, 2, 3]);
    }

    #[test]
    fn scheduled_task_is_a_boundary_in_order() {
        let dt = day_type("07:00:00", "22:00:00");
        let meals = vec![meal("Breakfast", "08:00:00", 0)];
        let tasks = vec![sched("Standup", "09:00:00")];
        let out = assemble_day_anchors(meals, tasks, Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            kinds(&out),
            vec![
                ScheduleAnchorKind::StartOfDay,
                ScheduleAnchorKind::Meal,
                ScheduleAnchorKind::ScheduledTask,
                ScheduleAnchorKind::EndOfDay,
            ]
        );
    }

    #[test]
    fn midnight_crossing_day_type_linearizes_wake_to_sleep() {
        // Night shift: wake 20:00, sleep 12:00 next day.
        let dt = day_type("20:00:00", "12:00:00");
        let meals = vec![
            meal("Breakfast", "08:00:00", 2),  // +12h from wake
            meal("Midnight snack", "01:00:00", 1), // +5h
            meal("Dinner", "21:00:00", 0),     // +1h
        ];
        let out = assemble_day_anchors(meals, vec![], Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            out.iter().map(|a| a.label.as_str()).collect::<Vec<_>>(),
            vec!["start of day", "Dinner", "Midnight snack", "Breakfast", "end of day"]
        );
    }

    #[test]
    fn empty_meals_day_still_has_sod_and_eod() {
        let dt = day_type("07:00:00", "22:00:00");
        let out = assemble_day_anchors(vec![], vec![], Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            kinds(&out),
            vec![ScheduleAnchorKind::StartOfDay, ScheduleAnchorKind::EndOfDay]
        );
    }

    #[test]
    fn no_active_day_type_yields_only_data_anchors() {
        let meals = vec![meal("Breakfast", "08:00:00", 0)];
        let out = assemble_day_anchors(meals, vec![], None, vec![], d(2026, 6, 16));
        assert_eq!(kinds(&out), vec![ScheduleAnchorKind::Meal]);
    }

    #[test]
    fn tz_anchor_included_only_for_in_day_boundary() {
        let dt = day_type("07:00:00", "22:00:00");
        let today = d(2026, 6, 16);
        let anchors = vec![
            tz(today, Some("14:00:00"), chrono_tz::America::Denver), // in-day → included
            tz(today, None, chrono_tz::America::New_York),           // whole-day → excluded
            tz(d(2026, 6, 10), Some("09:00:00"), chrono_tz::America::Chicago), // earlier date → excluded
        ];
        let out = assemble_day_anchors(vec![], vec![], Some(dt), anchors, today);
        let tz_anchors: Vec<&ScheduleAnchorResponse> = out
            .iter()
            .filter(|a| a.kind == ScheduleAnchorKind::TimezoneChange)
            .collect();
        assert_eq!(tz_anchors.len(), 1);
        assert_eq!(tz_anchors[0].zone.as_deref(), Some("America/Denver"));
        assert_eq!(tz_anchors[0].label, "America/Denver");
    }

    #[test]
    fn equal_offset_tie_break_is_deterministic() {
        let dt = day_type("07:00:00", "22:00:00");
        // A meal and a scheduled task at the same clock time: kind_rank breaks
        // the tie (meal before scheduled_task), stably.
        let meals = vec![meal("Lunch", "12:00:00", 0)];
        let tasks = vec![sched("Call", "12:00:00")];
        let out = assemble_day_anchors(meals, tasks, Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            kinds(&out),
            vec![
                ScheduleAnchorKind::StartOfDay,
                ScheduleAnchorKind::Meal,
                ScheduleAnchorKind::ScheduledTask,
                ScheduleAnchorKind::EndOfDay,
            ]
        );
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail, then pass**

Run: `cargo test -p plnd_api anchors:: 2>&1 | tail -20`
Expected: PASS (7 tests). If the `let`-chain (`if a.effective_date == date && let Some(t) = ...`) errors on the crate's edition, rewrite as a nested `if let Some(t) = a.effective_time { if a.effective_date == date { ... } }` — let-chains are used elsewhere in the codebase (`schedule_anchors.rs:148`), so they should compile.

- [ ] **Step 4: Format**

Run: `just fmt`
Expected: no diff or auto-formatted; exit 0.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/anchors.rs plnd_api/src/lib.rs
git commit -m "feat(schedule): assemble_day_anchors merges + orders all anchor sources (#958)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the route to all four sources

**Files:**
- Modify: `plnd_api/src/routes/schedule_anchors.rs` (rewrite `list_for_date`, lines 27-68; add imports)

- [ ] **Step 1: Update the `#[utoipa::path]` body and imports**

In `plnd_api/src/routes/schedule_anchors.rs`:

- Change the imports block (lines 8-14) so it pulls in the new response type and the day-type helper. Replace:

```rust
use crate::api_response::MealAnchorInstanceResponse;
```

with:

```rust
use crate::anchors::assemble_day_anchors;
use crate::api_response::{MealAnchorInstanceResponse, ScheduleAnchorResponse};
use crate::scheduling::day_type_applies_to;
```

- In the `#[utoipa::path]` for `list_for_date` (lines 27-40), change the 200 response line:

```rust
        (status = 200, description = "Ordered anchor sequence for the date (all four sources, §4.7); meals lazy-materialized on first call", body = Vec<ScheduleAnchorResponse>),
```

- [ ] **Step 2: Rewrite the `list_for_date` handler body**

Replace the entire `pub async fn list_for_date(...) { ... }` (lines 42-68) with:

```rust
pub async fn list_for_date(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListScheduleAnchorsQuery>,
) -> Result<Json<Vec<ScheduleAnchorResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let date = query.date;

    // (1) Meal anchors — keeps lazy materialization.
    let meals = state
        .repos
        .meal_anchor_instance
        .materialize(user_id, date)
        .await
        .map_err(map_list_error)?;

    // (2) Scheduled tasks — schedule entries with a fixed start time.
    let scheduled_tasks: Vec<_> = state
        .repos
        .schedule
        .get_day_entries(user_id, date)
        .await
        .map_err(map_list_error)?
        .into_iter()
        .filter(|e| e.scheduled_start.is_some())
        .collect();

    // (3) Active day type → start/end-of-day. Same precedence as materialize:
    // newest day type wins among those that apply to the date.
    let mut day_types = state
        .repos
        .day_type
        .list_for_user(user_id)
        .await
        .map_err(map_list_error)?;
    day_types.sort_by_key(|dt| std::cmp::Reverse(dt.created_at));
    let active_day_type = day_types.into_iter().find(|dt| day_type_applies_to(dt, date));

    // (4) Timezone-change anchors (folded in for in-day boundaries by the assembler).
    let tz_anchors = state
        .repos
        .timezone_anchor
        .list_through(user_id, date)
        .await
        .map_err(map_list_error)?;

    Ok(Json(assemble_day_anchors(
        meals,
        scheduled_tasks,
        active_day_type,
        tz_anchors,
        date,
    )))
}

/// Error mapping for the multi-source list (mirrors the prior inline mapping).
fn map_list_error(e: Error) -> StatusCode {
    match e {
        Error::ConnectionLost => StatusCode::SERVICE_UNAVAILABLE,
        e => {
            tracing::error!(error = %e, "list_schedule_anchors error");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `just verify-build 2>&1 | tail -20`
Expected: compiles clean. If `Error` is not in scope for `map_list_error`, note it is already imported (`use plnd_data::Error;`, line 20).

- [ ] **Step 4: Run the backend test suites touching this area**

Run: `cargo test -p plnd_api anchors:: 2>&1 | tail -5 && cargo test -p plnd_api --test schedule_anchors_test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
just fmt
git add plnd_api/src/routes/schedule_anchors.rs
git commit -m "feat(schedule): list_for_date returns unified anchor sequence (#958)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — unified DTO, keep day-view green

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts` (add after `MealAnchorInstanceDto`, line ~143)
- Modify: `plnd_client/src/app/core/services/schedule.service.ts` (import line 7; subscribe block lines ~44-77; `mapAnchorInstance` lines ~217-231)
- Modify: `plnd_client/src/app/core/services/schedule.service.spec.ts` (`anchorDto` helper lines 27-35; add one test)

- [ ] **Step 1: Add the unified DTO**

In `plnd_client/src/app/core/models/week-plan.ts`, after the `MealAnchorInstanceDto` interface (ends at the `}` on the line before `export interface SchedulePeriodResponse`):

```typescript
export type ScheduleAnchorKind =
  | 'meal'
  | 'scheduled_task'
  | 'start_of_day'
  | 'end_of_day'
  | 'timezone_change';

/** Unified anchor from GET /schedule/anchors (#958). Kind-specific fields are
 *  null unless they apply. `sequence` is the ordering primitive. */
export interface ScheduleAnchorDto {
  kind: ScheduleAnchorKind;
  sequence: number;
  time: string;                 // "HH:MM:SS"
  label: string;
  id: string | null;            // non-null for meal / scheduled_task
  status: string | null;        // meal only
  consumed_at: string | null;   // meal only
  tolerance_minutes: number | null;
  sort_order: number | null;
  template_entry_id: string | null;
  zone: string | null;          // timezone_change only
}
```

- [ ] **Step 2: Update the failing service spec helper + add a test**

In `plnd_client/src/app/core/services/schedule.service.spec.ts`, replace the `anchorDto` helper (lines 27-35) with the unified shape:

```typescript
/** A unified meal-kind ScheduleAnchorDto with sensible defaults (#958). */
function anchorDto(id: string, name: string, date = '2026-04-02'): Record<string, unknown> {
  return {
    kind: 'meal', sequence: 0, time: '08:00:00', label: name, id,
    status: 'planned', consumed_at: null,
    tolerance_minutes: 60, sort_order: 0, template_entry_id: null,
    zone: null,
    // legacy fields harmlessly ignored by the unified mapper:
    user_id: 'u1', date, name, preferred_time: '08:00:00',
    created_at: `${date}T08:00:00Z`, updated_at: `${date}T08:00:00Z`,
  };
}
```

Then add a test verifying non-meal anchors are ignored by the day-view mapping. Place it right after the existing `it('loadDay GETs /schedule/anchors with the date param', ...)` block (ends ~line 90):

```typescript
  it('ignores non-meal anchors when mapping the day (kind filter)', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [], carryover: [], planned_meals: [],
    });
    httpMock.expectOne(r => r.url.includes('/schedule/anchors')).flush([
      { kind: 'start_of_day', sequence: 0, time: '07:00:00', label: 'start of day',
        id: null, status: null, consumed_at: null, tolerance_minutes: null,
        sort_order: null, template_entry_id: null, zone: null },
      anchorDto('meal-1', 'breakfast'),
      { kind: 'end_of_day', sequence: 2, time: '22:00:00', label: 'end of day',
        id: null, status: null, consumed_at: null, tolerance_minutes: null,
        sort_order: null, template_entry_id: null, zone: null },
    ]);
    // Only the single meal anchor renders as an item row.
    expect(svc.items().length).toBe(1);
    expect(svc.items()[0].id).toBe('meal-1');
  });
```

(If the service's items signal is exposed under a different name than `items()`, match the existing tests in this file — search for `svc.` accessors near the top.)

- [ ] **Step 3: Run the spec to verify it fails**

Run (from the worktree): `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule.service.spec.ts' 2>&1 | tail -30`
Expected: FAIL — the service still types the response as `MealAnchorInstanceDto[]` and reads `dto.name`, so the new kind-filter test (and possibly type errors) fail.

- [ ] **Step 4: Update the service to consume the unified DTO**

In `plnd_client/src/app/core/services/schedule.service.ts`:

(a) Line 7 import — add `ScheduleAnchorDto`:

```typescript
import { MealAnchorInstanceDto, ScheduleAnchorDto, ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';
```

(b) Line 45 — change the GET generic and fallback:

```typescript
        anchors: this.http
          .get<ScheduleAnchorDto[]>(`${this.apiBase}/schedule/anchors`, { params: { date } })
          .pipe(catchError(() => of([] as ScheduleAnchorDto[]))),
```

(c) In the subscribe body, immediately after `if (schedule.error) ...` (line 50), insert the kind filter, then replace the three `anchors`/`a.id` usages with `meals` and a string id. The block from line 60 becomes:

```typescript
      // #958: the endpoint now returns all anchor kinds. The day-view still
      // renders only meals (full slot rendering is #959), so filter to meals.
      const meals = anchors.filter(a => a.kind === 'meal');
      const anchorIds = new Set(meals.map(a => a.id as string));
      const tasksByAnchor = new Map<string, ScheduleTask[]>();
      const topLevel: ScheduleTask[] = [];
      for (const e of schedule.data.entries) {
        const task = mapEntry(e);
        const anchorId = e.slot_meal_anchor_id;
        if (anchorId && anchorIds.has(anchorId)) {
          const tasks = tasksByAnchor.get(anchorId) ?? [];
          tasks.push(task);
          tasksByAnchor.set(anchorId, tasks);
        } else {
          topLevel.push(task);
        }
      }
      this._items.set([
        ...meals.map(a => mapAnchorInstance(a, mealByAnchor.get(a.id as string), tasksByAnchor.get(a.id as string) ?? [])),
        ...topLevel,
      ]);
```

(d) Update `mapAnchorInstance` (lines 217-231) to accept the unified DTO:

```typescript
function mapAnchorInstance(
  dto: ScheduleAnchorDto,
  planned?: PlannedMealEntryDto,
  duringMealTasks: ScheduleTask[] = [],
): MealAnchor {
  const slot = MEAL_SLOTS[dto.label.toLowerCase()];
  return {
    id:    dto.id as string,
    name:  slot?.name ?? dto.label,
    emoji: slot?.emoji ?? '🍴',
    status:      toMealUiStatus(dto.status ?? 'planned', planned?.title ?? undefined),
    description: planned?.title ?? undefined,
    duringMealTasks,
  };
}
```

If `MealAnchorInstanceDto` is now unused anywhere in this file, remove it from the line-7 import to satisfy `ts-lint` (check with the lint run in Step 6).

- [ ] **Step 5: Run the spec to verify it passes**

Run: `cd plnd_client && npx ng test --watch=false --browsers=ChromeHeadless --include='**/schedule.service.spec.ts' 2>&1 | tail -20`
Expected: PASS (all existing tests + the new kind-filter test).

- [ ] **Step 6: Lint the changed TS**

Run (from worktree root): `just ts-lint 2>&1 | tail -20`
Expected: clean (fix any unused-import error on `MealAnchorInstanceDto`).

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts plnd_client/src/app/core/services/schedule.service.ts plnd_client/src/app/core/services/schedule.service.spec.ts
git commit -m "feat(day-view): consume unified anchor DTO, filter kind=meal (#958)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification + PR

- [ ] **Step 1: Format Rust**

Run: `just fmt`
Expected: exit 0, no diff.

- [ ] **Step 2: Full pipeline**

Run: `just verify`
Expected: all gates pass (quality + build + Rust tests + Angular + e2e). The existing day-view e2e exercises `/schedule/anchors` end-to-end against the real backend; it must stay green — that is the integration coverage for the wired endpoint.

If e2e fails on the day-view: confirm the unified response still carries the meal fields the frontend reads (Task 1 contract) and that the `kind === 'meal'` filter is in place (Task 4c).

- [ ] **Step 3: Rebase onto origin/main, then push + open PR**

```bash
git fetch origin && git rebase origin/main
# after a clean rebase:
git push --force-with-lease -u origin HEAD
gh pr create --title "fix(schedule): /schedule/anchors returns all anchor sources (#958)" --body "$(cat <<'EOF'
Closes #958.

`GET /schedule/anchors` now returns a unified, ordered sequence of all four anchor sources (§4.7): meal instances, scheduled tasks, implicit start/end-of-day (from the active day type's wake/sleep), and in-day timezone-change anchors. Ordering uses a minutes-since-wake projection so midnight-crossing day types (§4.3) linearize; `sequence` is the §4.8 positional primitive.

- New `ScheduleAnchorResponse` / `ScheduleAnchorKind` (utoipa-annotated); meal-only behavior removed.
- Pure `assemble_day_anchors` (plnd_api/src/anchors.rs) with unit tests for each source, ordering, the midnight-crossing case, and the tz in-day-boundary rule. No plnd_data change — composes existing repositories.
- Timezone anchors fold into this sequence for in-day boundaries only; `/timezone/anchors` stays parallel for cross-day zone resolution (documented in the spec).
- Frontend: minimal — day-view consumes the unified DTO and filters `kind === 'meal'` (renders as before). Full slot rendering is #959.

Design spec: `docs/superpowers/specs/2026-06-16-unified-schedule-anchors-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Monitor CI**

Invoke the `monitor-pr` skill with the new PR number; address review comments and keep CI green.

---

## Self-Review notes

- **Spec coverage:** D1 → Task 1; D2 ordering → Task 2 (`order_key`, midnight-crossing test); D3 tz folding → Task 2 (`tz_anchor_included_only_for_in_day_boundary`) + route fetch (Task 3); D4 SOD/EOD → Task 2; D5 pure assembly/no plnd_data change → Task 2/3. Frontend minimal adaptation → Task 4. Acceptance "all four sources, one ordered sequence, midnight-crossing test, utoipa updated" → Tasks 1-3.
- **Test-layer deviation from spec:** spec sketched an HTTP "integration test"; this repo has no live-app harness, so the all-sources integration is covered by `assemble_day_anchors` unit tests + the existing day-view e2e. Documented in File Structure and Task 5.
- **Type consistency:** `assemble_day_anchors(meals, scheduled_tasks, active_day_type, tz_anchors, date)` and `ScheduleAnchorResponse` field names are identical across Tasks 1-3. Frontend `ScheduleAnchorDto` mirrors the Rust field names; `mapAnchorInstance` reads `dto.label`/`dto.id` consistently in Task 4.
