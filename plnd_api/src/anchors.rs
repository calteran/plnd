//! Unified day-anchor assembly (#958).
//!
//! Merges the four anchor sources (§4.7) — meal instances, scheduled tasks, the
//! implicit start/end-of-day, and in-day timezone changes — into one ordered
//! sequence. Ordering projects each anchor's wall-clock time onto a
//! seconds-since-wake axis so midnight-crossing day types (§4.3) linearize.
//! Pure and DB-free: the route fetches inputs via repositories and calls this.

use chrono::{DateTime, NaiveDate, NaiveTime, Timelike, Utc};
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

/// Total-order key: pinned-first/last bucket, then seconds-since-wake offset,
/// then a deterministic tie-break.
fn order_key(it: &Intermediate, wake: Option<NaiveTime>) -> (u8, i64, u8, i32, Uuid) {
    let pin_rank = match it.pin {
        Pin::First => 0,
        Pin::Mid => 1,
        Pin::Last => 2,
    };
    // Anchors whose time falls outside the wake→sleep window still sort by their
    // seconds-since-wake offset; because SOD/EOD are pin-bucketed (not offset-sorted),
    // such an anchor lands between the last in-window anchor and end-of-day.
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
    items.sort_by_key(|it| order_key(it, wake));

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
        let meals = vec![
            meal("Lunch", "12:00:00", 1),
            meal("Breakfast", "08:00:00", 0),
        ];
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
        assert_eq!(
            out.iter().map(|a| a.sequence).collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );
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
    fn scheduled_task_without_start_is_skipped() {
        let dt = day_type("07:00:00", "22:00:00");
        let mut e = sched("No time", "09:00:00");
        e.scheduled_start = None;
        let out = assemble_day_anchors(vec![], vec![e], Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            kinds(&out),
            vec![ScheduleAnchorKind::StartOfDay, ScheduleAnchorKind::EndOfDay]
        );
    }

    #[test]
    fn midnight_crossing_day_type_linearizes_wake_to_sleep() {
        // Night shift: wake 20:00, sleep 12:00 next day.
        let dt = day_type("20:00:00", "12:00:00");
        let meals = vec![
            meal("Breakfast", "08:00:00", 2),      // +12h from wake
            meal("Midnight snack", "01:00:00", 1), // +5h
            meal("Dinner", "21:00:00", 0),         // +1h
        ];
        let out = assemble_day_anchors(meals, vec![], Some(dt), vec![], d(2026, 6, 16));
        assert_eq!(
            out.iter().map(|a| a.label.as_str()).collect::<Vec<_>>(),
            vec![
                "start of day",
                "Dinner",
                "Midnight snack",
                "Breakfast",
                "end of day"
            ]
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
            tz(
                d(2026, 6, 10),
                Some("09:00:00"),
                chrono_tz::America::Chicago,
            ), // earlier date → excluded
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
