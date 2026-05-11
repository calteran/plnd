use chrono::{Datelike, NaiveDate, Weekday};
use plnd_data::models::DayType;

/// True if `day_type` covers `date`.
///
/// - Weekday types: tests `days_bitmask` (bit 0 = Sunday … bit 6 = Saturday).
/// - Cycle types: computes `(date − anchor_date) mod cycle_length` (Euclidean
///   remainder, so dates before the anchor map to the right position) and tests
///   the corresponding bit in `cycle_bitmask`.
/// - Cycle types missing `cycle_length` or `anchor_date` return `false`. Should
///   be unreachable post-validation (`validate_day_type_request`).
pub(crate) fn day_type_applies_to(day_type: &DayType, date: NaiveDate) -> bool {
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

/// Returns all dates in [start, end] where `rule` produces a constrained instance
/// (date is fixed; the LLM picks time only).
///
/// - `FREQ=DAILY` → every calendar day in the window
/// - `FREQ=WEEKLY;BYDAY=MO,...` → matching weekdays in the window
///
/// All other patterns return an empty `Vec`.
pub fn constrained_dates_for_rule(rule: &str, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let rule_uc = rule.to_uppercase();
    if !rule_uc.starts_with("FREQ=") {
        return Vec::new();
    }
    let freq = param_value(&rule_uc, "FREQ").unwrap_or_default();
    match freq {
        "DAILY" => iter_window(start, end).collect(),
        "WEEKLY" if rule_uc.contains("BYDAY=") => iter_window(start, end)
            .filter(|d| byday_matches(*d, &rule_uc))
            .collect(),
        _ => Vec::new(),
    }
}

/// Returns `true` if `rule` should produce exactly one floating instance in [start, end]
/// (the LLM picks both day and time).
///
/// - Bare `FREQ=WEEKLY` (no `BYDAY`) → always `true`
/// - `FREQ=MONTHLY;BYMONTHDAY=D` → `true` iff any date with day=D is in [start, end]
/// - `FREQ=YEARLY;BYMONTH=M;BYMONTHDAY=D` → `true` iff that exact date is in [start, end]
///
/// All other patterns return `false`.
pub fn has_floating_instance_in_window(rule: &str, start: NaiveDate, end: NaiveDate) -> bool {
    let rule_uc = rule.to_uppercase();
    if !rule_uc.starts_with("FREQ=") {
        return false;
    }
    let freq = param_value(&rule_uc, "FREQ").unwrap_or_default();
    match freq {
        "WEEKLY" => param_value(&rule_uc, "BYDAY").is_none(),
        "MONTHLY" => {
            let Some(day) = param_value(&rule_uc, "BYMONTHDAY").and_then(|v| v.parse::<u32>().ok())
            else {
                return false;
            };
            iter_window(start, end).any(|d| d.day() == day)
        }
        "YEARLY" => {
            let (Some(month), Some(day)) = (
                param_value(&rule_uc, "BYMONTH").and_then(|v| v.parse::<u32>().ok()),
                param_value(&rule_uc, "BYMONTHDAY").and_then(|v| v.parse::<u32>().ok()),
            ) else {
                return false;
            };
            iter_window(start, end).any(|d| d.month() == month && d.day() == day)
        }
        _ => false,
    }
}

/// True if `date` falls on a weekday in the `BYDAY=` component of an **uppercase** RRULE string.
pub(crate) fn byday_matches(date: NaiveDate, rule_uc: &str) -> bool {
    let Some(byday_value) = param_value(rule_uc, "BYDAY") else {
        return false;
    };
    let target = date.weekday();
    byday_value
        .split(',')
        .any(|abbrev| weekday_from_abbrev(abbrev.trim()) == Some(target))
}

/// True if `date` matches `rule` (supports legacy simple rules and RRULE BYDAY patterns).
#[cfg(test)]
fn date_matches_recurrence(date: NaiveDate, rule: &str) -> bool {
    let rule_lc = rule.to_lowercase();
    match rule_lc.as_str() {
        "daily" => true,
        "weekdays" => date.weekday().num_days_from_monday() < 5,
        "weekends" => date.weekday().num_days_from_monday() >= 5,
        _ if rule_lc.contains("byday=") => byday_matches(date, &rule.to_uppercase()),
        _ => false,
    }
}

fn weekday_from_abbrev(abbrev: &str) -> Option<Weekday> {
    match abbrev {
        "MO" => Some(Weekday::Mon),
        "TU" => Some(Weekday::Tue),
        "WE" => Some(Weekday::Wed),
        "TH" => Some(Weekday::Thu),
        "FR" => Some(Weekday::Fri),
        "SA" => Some(Weekday::Sat),
        "SU" => Some(Weekday::Sun),
        _ => None,
    }
}

fn param_value<'a>(rule_uc: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("{key}=");
    rule_uc.split(';').find_map(|p| {
        let p = p.trim();
        p.starts_with(needle.as_str()).then(|| &p[needle.len()..])
    })
}

fn iter_window(start: NaiveDate, end: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    let mut current = start;
    let mut done = false;
    std::iter::from_fn(move || {
        if done || current > end {
            return None;
        }
        let result = current;
        match current.succ_opt() {
            Some(next) => current = next,
            None => done = true,
        }
        Some(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    // ── constrained_dates_for_rule ──────────────────────────────────────────

    #[test]
    fn daily_over_three_day_window() {
        let dates = constrained_dates_for_rule("FREQ=DAILY", d(2026, 4, 28), d(2026, 4, 30));
        assert_eq!(dates, vec![d(2026, 4, 28), d(2026, 4, 29), d(2026, 4, 30)]);
    }

    #[test]
    fn daily_single_day_window() {
        let dates = constrained_dates_for_rule("FREQ=DAILY", d(2026, 4, 28), d(2026, 4, 28));
        assert_eq!(dates, vec![d(2026, 4, 28)]);
    }

    #[test]
    fn weekly_byday_mo_we_fr_over_week() {
        let rule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
        let dates = constrained_dates_for_rule(rule, d(2026, 4, 27), d(2026, 5, 3));
        assert_eq!(dates, vec![d(2026, 4, 27), d(2026, 4, 29), d(2026, 5, 1)]);
    }

    #[test]
    fn bare_weekly_returns_empty_constrained() {
        let dates = constrained_dates_for_rule("FREQ=WEEKLY", d(2026, 4, 27), d(2026, 5, 3));
        assert!(dates.is_empty());
    }

    #[test]
    fn monthly_returns_empty_constrained() {
        let dates =
            constrained_dates_for_rule("FREQ=MONTHLY;BYMONTHDAY=15", d(2026, 4, 27), d(2026, 5, 3));
        assert!(dates.is_empty());
    }

    #[test]
    fn unknown_rule_returns_empty_constrained() {
        let dates = constrained_dates_for_rule("garbage", d(2026, 4, 27), d(2026, 5, 3));
        assert!(dates.is_empty());
    }

    // ── has_floating_instance_in_window ────────────────────────────────────

    #[test]
    fn bare_weekly_is_floating() {
        assert!(has_floating_instance_in_window(
            "FREQ=WEEKLY",
            d(2026, 4, 27),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn weekly_with_byday_is_not_floating() {
        assert!(!has_floating_instance_in_window(
            "FREQ=WEEKLY;BYDAY=MO",
            d(2026, 4, 27),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn monthly_with_occurrence_in_window() {
        assert!(has_floating_instance_in_window(
            "FREQ=MONTHLY;BYMONTHDAY=28",
            d(2026, 4, 28),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn monthly_with_no_occurrence_in_window() {
        assert!(!has_floating_instance_in_window(
            "FREQ=MONTHLY;BYMONTHDAY=10",
            d(2026, 4, 28),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn monthly_without_bymonthday_returns_false() {
        assert!(!has_floating_instance_in_window(
            "FREQ=MONTHLY",
            d(2026, 4, 28),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn yearly_with_occurrence_in_window() {
        assert!(has_floating_instance_in_window(
            "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=28",
            d(2026, 4, 27),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn yearly_with_no_occurrence_in_window() {
        assert!(!has_floating_instance_in_window(
            "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1",
            d(2026, 4, 27),
            d(2026, 5, 3)
        ));
    }

    #[test]
    fn unknown_rule_not_floating() {
        assert!(!has_floating_instance_in_window(
            "garbage",
            d(2026, 4, 27),
            d(2026, 5, 3)
        ));
    }

    // ── date_matches_recurrence (extracted from schedule.rs) ───────────────

    #[test]
    fn daily_matches_every_day() {
        assert!(date_matches_recurrence(d(2026, 4, 27), "daily"));
        assert!(date_matches_recurrence(d(2026, 5, 3), "daily"));
    }

    #[test]
    fn weekdays_matches_mon_to_fri_only() {
        assert!(date_matches_recurrence(d(2026, 4, 27), "weekdays")); // Mon
        assert!(date_matches_recurrence(d(2026, 4, 28), "weekdays")); // Tue
        assert!(date_matches_recurrence(d(2026, 5, 1), "weekdays")); // Fri
        assert!(!date_matches_recurrence(d(2026, 5, 2), "weekdays")); // Sat
        assert!(!date_matches_recurrence(d(2026, 5, 3), "weekdays")); // Sun
    }

    #[test]
    fn weekends_matches_sat_and_sun_only() {
        assert!(date_matches_recurrence(d(2026, 5, 2), "weekends")); // Sat
        assert!(date_matches_recurrence(d(2026, 5, 3), "weekends")); // Sun
        assert!(!date_matches_recurrence(d(2026, 4, 27), "weekends")); // Mon
        assert!(!date_matches_recurrence(d(2026, 5, 1), "weekends")); // Fri
    }

    #[test]
    fn rrule_byday_mo_matches_mondays_only() {
        assert!(date_matches_recurrence(
            d(2026, 4, 27),
            "FREQ=WEEKLY;BYDAY=MO"
        ));
        assert!(!date_matches_recurrence(
            d(2026, 4, 28),
            "FREQ=WEEKLY;BYDAY=MO"
        ));
    }

    #[test]
    fn rrule_byday_multi_day() {
        let rule = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
        assert!(date_matches_recurrence(d(2026, 4, 27), rule)); // Mon
        assert!(!date_matches_recurrence(d(2026, 4, 28), rule)); // Tue
        assert!(date_matches_recurrence(d(2026, 4, 29), rule)); // Wed
    }

    #[test]
    fn unknown_recurrence_returns_false() {
        assert!(!date_matches_recurrence(d(2026, 4, 27), "quarterly"));
        assert!(!date_matches_recurrence(d(2026, 4, 27), ""));
    }

    // ── day_type_applies_to ────────────────────────────────────────────────

    fn weekday_dt(name: &str, days_bitmask: i32) -> DayType {
        use chrono::{NaiveTime, TimeZone, Utc};
        DayType {
            id: uuid::Uuid::new_v4(),
            user_id: uuid::Uuid::new_v4(),
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
        assert!(!day_type_applies_to(
            &dt,
            anchor + chrono::Duration::days(1)
        ));
        assert!(day_type_applies_to(&dt, anchor + chrono::Duration::days(2)));
    }

    #[test]
    fn cycle_three_on_three_off_repeats() {
        // Length=6, bitmask=0b000111 → "on" for positions 0..2, "off" for 3..5.
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("On3Off3", 6, anchor, 0b000111);
        for offset in 0_i64..3 {
            assert!(
                day_type_applies_to(&dt, anchor + chrono::Duration::days(offset)),
                "offset {offset} should match"
            );
        }
        for offset in 3_i64..6 {
            assert!(
                !day_type_applies_to(&dt, anchor + chrono::Duration::days(offset)),
                "offset {offset} should not match"
            );
        }
        // Pattern repeats: anchor+6 is position 0 again.
        assert!(day_type_applies_to(&dt, anchor + chrono::Duration::days(6)));
        assert!(!day_type_applies_to(
            &dt,
            anchor + chrono::Duration::days(9)
        ));
    }

    #[test]
    fn cycle_date_before_anchor_resolves_via_euclidean_remainder() {
        // Length=4, bitmask=0b0001 → only position 0 matches.
        // 4 days before anchor = position 0 (-4 mod 4 = 0). 1 day before = position 3.
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("Quad", 4, anchor, 0b0001);
        assert!(day_type_applies_to(
            &dt,
            anchor + chrono::Duration::days(-4)
        ));
        assert!(!day_type_applies_to(
            &dt,
            anchor + chrono::Duration::days(-1)
        ));
    }

    #[test]
    fn cycle_full_coverage_matches_every_date() {
        // Length=4, bitmask=0b1111 (all positions covered).
        let anchor = d(2026, 4, 27);
        let dt = cycle_dt("Full", 4, anchor, 0b1111);
        for offset in 0_i64..14 {
            assert!(day_type_applies_to(
                &dt,
                anchor + chrono::Duration::days(offset)
            ));
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
