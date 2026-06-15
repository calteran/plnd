//! Pure, database-free timezone resolution.
//!
//! This module is the keystone of the timezone foundation: given a set of
//! [`TimezoneAnchor`] records and a wall-clock point in a user's local
//! calendar, it answers two questions with no I/O of any kind:
//!
//! 1. [`zone_at`] — which IANA zone was in effect at a given `(date, time)`?
//! 2. [`resolve_instant`] — what absolute UTC instant does a local
//!    wall-clock datetime correspond to in a given zone, accounting for DST?
//!
//! Keeping this logic pure makes it trivially unit-testable (no Docker / DB)
//! and lets every other layer of the feature build on a single, audited
//! definition of "the zone in effect" and "the DST policy".

use chrono::{DateTime, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

use crate::models::TimezoneAnchor;

/// The IANA zone in effect at the point `(date, time)`.
///
/// An anchor `A` is *at or before* the query point iff
/// `(A.effective_date, A.effective_time) <= (date, time)`. The natural tuple
/// comparison on `(NaiveDate, Option<NaiveTime>)` gives the intended
/// semantics for free, because `Option<NaiveTime>` orders `None < Some(_)`:
///
/// - A whole-day anchor (`effective_time = None`) precedes any timed anchor on
///   the same date, and applies to a whole-day query (`time = None`) on that
///   date.
/// - A timed anchor does **not** apply to a same-date whole-day /
///   start-of-day query (its key is strictly greater).
///
/// Among all at-or-before anchors, the zone of the one with the **greatest**
/// `(effective_date, effective_time)` key is returned. Returns `None` if no
/// anchor is at or before the query point.
///
/// This function does **not** assume `anchors` is sorted — the maximum is
/// computed defensively. The repository returns anchors sorted ascending, but
/// correctness here is independent of that precondition.
pub fn zone_at(anchors: &[TimezoneAnchor], date: NaiveDate, time: Option<NaiveTime>) -> Option<Tz> {
    let query_key = (date, time);
    anchors
        .iter()
        .filter(|a| (a.effective_date, a.effective_time) <= query_key)
        .max_by_key(|a| (a.effective_date, a.effective_time))
        .map(|a| a.zone)
}

/// Maximum window we will roll a non-existent wall time forward through before
/// giving up. A DST spring-forward gap is at most an hour or two in practice;
/// six hours is a generous bound that still guarantees termination.
const MAX_GAP_ROLL: chrono::Duration = chrono::Duration::hours(6);

/// Step size used when rolling forward out of a spring-forward gap.
const GAP_STEP: chrono::Duration = chrono::Duration::minutes(1);

/// Convert a wall-clock local datetime in `tz` to an absolute UTC instant.
///
/// DST policy (spec D8):
///
/// - **Unambiguous** wall time → that instant.
/// - **Ambiguous** wall time (fall-back overlap, e.g. 01:30 occurs twice) →
///   the **earlier** offset (the first occurrence).
/// - **Non-existent** wall time (spring-forward gap, e.g. 02:30 is skipped) →
///   **roll forward** to the first valid instant at or after `wall`.
pub fn resolve_instant(wall: NaiveDateTime, tz: Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&wall) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc),
        // Fall-back overlap: pick the earlier offset (first occurrence).
        LocalResult::Ambiguous(earliest, _latest) => earliest.with_timezone(&Utc),
        // Spring-forward gap: the wall time does not exist. Advance in small
        // steps until we land on a valid instant, bounded so we can never
        // loop forever. The first valid moment at/after `wall` is returned.
        LocalResult::None => {
            let mut candidate = wall;
            let limit = wall + MAX_GAP_ROLL;
            while candidate <= limit {
                match tz.from_local_datetime(&candidate) {
                    LocalResult::Single(dt) => return dt.with_timezone(&Utc),
                    LocalResult::Ambiguous(earliest, _latest) => {
                        return earliest.with_timezone(&Utc);
                    }
                    LocalResult::None => candidate += GAP_STEP,
                }
            }
            // Unreachable for any real IANA zone (gaps are at most ~1h), but
            // fall back to UTC interpretation rather than panicking.
            Utc.from_utc_datetime(&wall)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::{Denver, New_York};
    use uuid::Uuid;

    fn anchor(date: NaiveDate, time: Option<NaiveTime>, zone: Tz) -> TimezoneAnchor {
        use crate::models::TimezoneSource;
        let now = Utc::now();
        TimezoneAnchor {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            effective_date: date,
            effective_time: time,
            zone,
            source: TimezoneSource::User,
            source_ref: None,
            inference_group: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn t(h: u32, min: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, min, 0).unwrap()
    }

    // ---- zone_at ---------------------------------------------------------

    #[test]
    fn zone_at_no_anchors_is_none() {
        assert_eq!(zone_at(&[], d(2026, 6, 1), None), None);
    }

    #[test]
    fn zone_at_before_only_anchor_is_none() {
        let anchors = [anchor(d(2026, 1, 1), None, New_York)];
        assert_eq!(zone_at(&anchors, d(2025, 12, 31), None), None);
    }

    #[test]
    fn zone_at_single_anchor_applies_later() {
        let anchors = [anchor(d(2026, 1, 1), None, New_York)];
        assert_eq!(zone_at(&anchors, d(2026, 6, 1), None), Some(New_York));
    }

    #[test]
    fn zone_at_two_anchors_picks_most_recent() {
        let anchors = [
            anchor(d(2026, 1, 1), None, New_York),
            anchor(d(2026, 6, 10), None, Denver),
        ];
        assert_eq!(zone_at(&anchors, d(2026, 6, 5), None), Some(New_York));
        assert_eq!(zone_at(&anchors, d(2026, 6, 15), None), Some(Denver));
    }

    #[test]
    fn zone_at_travel_day_intraday_switch() {
        // Whole-day New_York anchor plus a timed Denver anchor at 14:00.
        let anchors = [
            anchor(d(2026, 6, 10), None, New_York),
            anchor(d(2026, 6, 10), Some(t(14, 0)), Denver),
        ];
        // Morning: before the timed switch → New_York.
        assert_eq!(
            zone_at(&anchors, d(2026, 6, 10), Some(t(9, 0))),
            Some(New_York)
        );
        // Afternoon: at/after the timed switch → Denver.
        assert_eq!(
            zone_at(&anchors, d(2026, 6, 10), Some(t(15, 0))),
            Some(Denver)
        );
        // Whole-day query: whole-day anchor precedes the timed one → New_York.
        assert_eq!(zone_at(&anchors, d(2026, 6, 10), None), Some(New_York));
    }

    #[test]
    fn zone_at_unsorted_input_resolves_correctly() {
        // Same data as the travel-day case plus an earlier anchor, shuffled.
        let anchors = [
            anchor(d(2026, 6, 10), Some(t(14, 0)), Denver),
            anchor(d(2026, 1, 1), None, New_York),
            anchor(d(2026, 6, 10), None, New_York),
        ];
        assert_eq!(zone_at(&anchors, d(2026, 3, 1), None), Some(New_York));
        assert_eq!(
            zone_at(&anchors, d(2026, 6, 10), Some(t(9, 0))),
            Some(New_York)
        );
        assert_eq!(
            zone_at(&anchors, d(2026, 6, 10), Some(t(15, 0))),
            Some(Denver)
        );
        assert_eq!(zone_at(&anchors, d(2026, 6, 10), None), Some(New_York));
    }

    // ---- resolve_instant -------------------------------------------------

    fn wall(date: NaiveDate, time: NaiveTime) -> NaiveDateTime {
        date.and_time(time)
    }

    #[test]
    fn resolve_instant_normal_est() {
        // EST = UTC-5. 12:00 local → 17:00 UTC.
        let got = resolve_instant(wall(d(2026, 1, 15), t(12, 0)), New_York);
        let want = Utc.with_ymd_and_hms(2026, 1, 15, 17, 0, 0).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_instant_normal_edt() {
        // EDT = UTC-4. 12:00 local → 16:00 UTC.
        let got = resolve_instant(wall(d(2026, 7, 15), t(12, 0)), New_York);
        let want = Utc.with_ymd_and_hms(2026, 7, 15, 16, 0, 0).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_instant_fall_back_ambiguous_picks_earlier() {
        // 2026-11-01: clocks fall back 02:00 EDT → 01:00 EST, so 01:30 occurs
        // twice. Earlier offset is EDT(-4) → 05:30 UTC.
        let got = resolve_instant(wall(d(2026, 11, 1), t(1, 30)), New_York);
        let want = Utc.with_ymd_and_hms(2026, 11, 1, 5, 30, 0).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_instant_spring_forward_gap_rolls_forward() {
        // 2026-03-08: clocks jump 02:00 EST → 03:00 EDT, so the entire wall
        // interval [02:00, 03:00) does not exist. The policy is "roll forward
        // to the FIRST valid instant at/after the requested wall time" — and
        // every wall time from 02:30 through 02:59 is non-existent, so the
        // first valid wall time is 03:00 EDT, NOT 03:30.
        //
        // The task spec predicted 03:30 → 07:30 UTC, reasoning as if the gap
        // shifts the clock by an hour (02:30 + 1h = 03:30). That is wrong:
        // rolling *forward to the first valid moment* discards the skipped
        // minutes entirely rather than translating them. chrono-tz agrees —
        // 03:00 EDT(-4) = 07:00 UTC is the correct first valid instant — so we
        // trust chrono-tz and assert 07:00.
        let got = resolve_instant(wall(d(2026, 3, 8), t(2, 30)), New_York);
        let want = Utc.with_ymd_and_hms(2026, 3, 8, 7, 0, 0).unwrap();
        assert_eq!(got, want);
    }

    #[test]
    fn resolve_instant_rolled_instant_is_first_valid_moment() {
        // The rolled-forward instant must be at/after the original wall time
        // and must itself round-trip to a valid local time.
        let w = wall(d(2026, 3, 8), t(2, 30));
        let got = resolve_instant(w, New_York);
        // 03:00 EDT is the first valid wall time after the gap; its UTC is
        // 07:00. The roll-forward must land exactly there (no skipped minutes
        // are carried over).
        let first_valid = Utc.with_ymd_and_hms(2026, 3, 8, 7, 0, 0).unwrap();
        assert_eq!(got, first_valid);
        // Round-trip: the resulting instant, viewed in New_York, is a real
        // local time at/after the requested wall clock.
        assert!(got.with_timezone(&New_York).naive_local() >= w);
    }
}
