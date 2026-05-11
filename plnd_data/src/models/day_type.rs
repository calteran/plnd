use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DayType {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    /// Bitmask: bit 0 = Sunday, bit 1 = Monday, …, bit 6 = Saturday.
    /// Must be 0 when `is_cycle = true` (XOR invariant).
    pub days_bitmask: i32,
    pub wake_time: NaiveTime,
    pub sleep_time: NaiveTime,
    pub is_cycle: bool,
    pub cycle_length: Option<i32>,
    pub anchor_date: Option<NaiveDate>,
    /// For cycle types: low `cycle_length` bits indicate which positions in the
    /// cycle this day type covers, where position 0 is `anchor_date`. Must be 0
    /// when `is_cycle = false`. See [`day_type_applies_to`] for resolution semantics.
    pub cycle_bitmask: i32,
    pub created_at: DateTime<Utc>,
}

/// True if `day_type` covers `date`.
///
/// - Weekday types: tests `days_bitmask` (bit 0 = Sunday … bit 6 = Saturday).
/// - Cycle types: computes `(date − anchor_date) mod cycle_length` (Euclidean
///   remainder, so dates before the anchor map to the right position) and tests
///   the corresponding bit in `cycle_bitmask`.
/// - Cycle types missing `cycle_length` or `anchor_date` return `false`. Should
///   be unreachable post-validation (`validate_day_type_request`).
pub fn day_type_applies_to(day_type: &DayType, date: NaiveDate) -> bool {
    if day_type.is_cycle {
        let (Some(length), Some(anchor)) = (day_type.cycle_length, day_type.anchor_date) else {
            return false;
        };
        if length <= 0 {
            return false;
        }
        let days_offset = (date - anchor).num_days();
        let position = days_offset.rem_euclid(length as i64) as i32;
        return (day_type.cycle_bitmask & (1_i32 << position)) != 0;
    }
    let bit = 1_i32 << date.weekday().num_days_from_sunday();
    (day_type.days_bitmask & bit) != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, NaiveDate, NaiveTime, TimeZone, Utc};
    use uuid::Uuid;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn weekday_dt(name: &str, days_bitmask: i32) -> DayType {
        DayType {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: name.to_string(),
            days_bitmask,
            wake_time: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            sleep_time: NaiveTime::from_hms_opt(22, 0, 0).unwrap(),
            is_cycle: false,
            cycle_length: None,
            anchor_date: None,
            cycle_bitmask: 0,
            created_at: Utc.timestamp_opt(0, 0).unwrap(),
        }
    }

    fn cycle_dt(name: &str, length: i32, anchor: NaiveDate, cycle_bitmask: i32) -> DayType {
        let mut dt = weekday_dt(name, 0);
        dt.is_cycle = true;
        dt.cycle_length = Some(length);
        dt.anchor_date = Some(anchor);
        dt.cycle_bitmask = cycle_bitmask;
        dt
    }

    #[test]
    fn day_type_applies_to_weekday_match() {
        // bit 1 = Monday; 2026-04-27 is a Monday.
        let dt = weekday_dt("Mondays", 0b0000010);
        assert!(day_type_applies_to(&dt, d(2026, 4, 27)));
    }

    #[test]
    fn day_type_applies_to_weekday_non_match() {
        // bit 1 = Monday; 2026-04-28 is a Tuesday.
        let dt = weekday_dt("Mondays", 0b0000010);
        assert!(!day_type_applies_to(&dt, d(2026, 4, 28)));
    }

    #[test]
    fn day_type_applies_to_weekday_multi_day_bitmask() {
        // Mon..Fri = bits 1..5 = 0b0111110.
        let dt = weekday_dt("Weekdays", 0b0111110);
        assert!(day_type_applies_to(&dt, d(2026, 4, 27))); // Mon
        assert!(day_type_applies_to(&dt, d(2026, 5, 1))); // Fri
        assert!(!day_type_applies_to(&dt, d(2026, 5, 2))); // Sat
        assert!(!day_type_applies_to(&dt, d(2026, 5, 3))); // Sun
    }

    #[test]
    fn day_type_applies_to_weekend_bitmask() {
        // Sat = bit 6; Sun = bit 0.
        let dt = weekday_dt("Weekends", 0b1000001);
        assert!(day_type_applies_to(&dt, d(2026, 5, 2))); // Sat
        assert!(day_type_applies_to(&dt, d(2026, 5, 3))); // Sun
        assert!(!day_type_applies_to(&dt, d(2026, 4, 27))); // Mon
    }

    #[test]
    fn cycle_one_of_two_alternating() {
        // Length=2, bitmask=0b01 → matches anchor and anchor+2, not anchor+1.
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("Alt", 2, anchor, 0b01);
        assert!(day_type_applies_to(&dt, anchor));
        assert!(!day_type_applies_to(&dt, anchor + Duration::days(1)));
        assert!(day_type_applies_to(&dt, anchor + Duration::days(2)));
    }

    #[test]
    fn cycle_three_on_three_off_repeats() {
        // Length=6, bitmask=0b000111 → "on" for positions 0..2, "off" for 3..5.
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("On3Off3", 6, anchor, 0b000111);
        for offset in 0_i64..3 {
            assert!(
                day_type_applies_to(&dt, anchor + Duration::days(offset)),
                "offset {offset} should match"
            );
        }
        for offset in 3_i64..6 {
            assert!(
                !day_type_applies_to(&dt, anchor + Duration::days(offset)),
                "offset {offset} should not match"
            );
        }
        // Pattern repeats: anchor+6 is position 0 again.
        assert!(day_type_applies_to(&dt, anchor + Duration::days(6)));
        assert!(!day_type_applies_to(&dt, anchor + Duration::days(9)));
    }

    #[test]
    fn cycle_date_before_anchor_resolves_via_euclidean_remainder() {
        // Length=4, bitmask=0b0001 → only position 0 matches.
        // 4 days before anchor = position 0 (-4 mod 4 = 0). 1 day before = position 3.
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("Quad", 4, anchor, 0b0001);
        assert!(day_type_applies_to(&dt, anchor + Duration::days(-4)));
        assert!(!day_type_applies_to(&dt, anchor + Duration::days(-1)));
    }

    #[test]
    fn cycle_full_coverage_matches_every_date() {
        // Length=4, bitmask=0b1111 (all positions covered).
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("Full", 4, anchor, 0b1111);
        for offset in 0_i64..14 {
            assert!(day_type_applies_to(&dt, anchor + Duration::days(offset)));
        }
    }

    #[test]
    fn cycle_invalid_state_returns_false() {
        // Defensive: missing length or anchor_date returns false even if is_cycle=true.
        let mut dt = cycle_dt("Bad", 4, d(2026, 4, 27), 0b1111);
        dt.cycle_length = None;
        assert!(!day_type_applies_to(&dt, d(2026, 4, 27)));

        let mut dt2 = cycle_dt("Bad", 4, d(2026, 4, 27), 0b1111);
        dt2.anchor_date = None;
        assert!(!day_type_applies_to(&dt2, d(2026, 4, 27)));
    }
}
