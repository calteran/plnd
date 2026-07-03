use chrono::{Datelike, NaiveDate, Weekday};

pub(crate) use plnd_data::models::day_type_applies_to;

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

/// Human-readable recurrence frequency for a routine's RRULE, in the same
/// vocabulary as the client's `RecurrenceType` (`daily` | `weekdays` | `weekly`
/// | `monthly` | `yearly`). Returns `None` for rules with no recognizable
/// `FREQ=` token.
///
/// Keys off the `FREQ=` param (like [`constrained_dates_for_rule`]) rather than
/// exact-string matching, so it still labels the `BYMONTHDAY`/`BYMONTH`-bearing
/// monthly and yearly rules that reach `routine_prior_context`. A `FREQ=WEEKLY`
/// rule whose `BYDAY` is exactly the Mon–Fri set is reported as `weekdays`
/// (near-daily); any other weekly rule is `weekly`.
pub fn recurrence_frequency_label(rule: &str) -> Option<&'static str> {
    let rule_uc = rule.to_uppercase();
    if !rule_uc.starts_with("FREQ=") {
        return None;
    }
    match param_value(&rule_uc, "FREQ")? {
        "DAILY" => Some("daily"),
        "WEEKLY" if is_weekday_set(&rule_uc) => Some("weekdays"),
        "WEEKLY" => Some("weekly"),
        "MONTHLY" => Some("monthly"),
        "YEARLY" => Some("yearly"),
        _ => None,
    }
}

/// True if the RRULE's `BYDAY` is exactly the Monday–Friday set (the canonical
/// `weekdays` recurrence), in any order.
fn is_weekday_set(rule_uc: &str) -> bool {
    let Some(byday) = param_value(rule_uc, "BYDAY") else {
        return false;
    };
    let days: std::collections::HashSet<&str> = byday.split(',').map(str::trim).collect();
    days == std::collections::HashSet::from(["MO", "TU", "WE", "TH", "FR"])
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

    // ── recurrence_frequency_label ─────────────────────────────────────────

    #[test]
    fn label_daily() {
        assert_eq!(recurrence_frequency_label("FREQ=DAILY"), Some("daily"));
    }

    #[test]
    fn label_weekdays_full_mon_fri_set() {
        assert_eq!(
            recurrence_frequency_label("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
            Some("weekdays")
        );
    }

    #[test]
    fn label_weekdays_is_order_independent() {
        assert_eq!(
            recurrence_frequency_label("FREQ=WEEKLY;BYDAY=FR,MO,TH,TU,WE"),
            Some("weekdays")
        );
    }

    #[test]
    fn label_weekly_single_day() {
        assert_eq!(
            recurrence_frequency_label("FREQ=WEEKLY;BYDAY=MO"),
            Some("weekly")
        );
    }

    #[test]
    fn label_weekly_partial_multi_day_is_not_weekdays() {
        assert_eq!(
            recurrence_frequency_label("FREQ=WEEKLY;BYDAY=MO,WE,FR"),
            Some("weekly")
        );
    }

    #[test]
    fn label_bare_weekly() {
        assert_eq!(recurrence_frequency_label("FREQ=WEEKLY"), Some("weekly"));
    }

    #[test]
    fn label_monthly_with_bymonthday() {
        assert_eq!(
            recurrence_frequency_label("FREQ=MONTHLY;BYMONTHDAY=10"),
            Some("monthly")
        );
    }

    #[test]
    fn label_yearly_with_bymonth_and_bymonthday() {
        assert_eq!(
            recurrence_frequency_label("FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=28"),
            Some("yearly")
        );
    }

    #[test]
    fn label_is_case_insensitive() {
        assert_eq!(recurrence_frequency_label("freq=daily"), Some("daily"));
    }

    #[test]
    fn label_unrecognized_rule_is_none() {
        assert_eq!(recurrence_frequency_label("garbage"), None);
        assert_eq!(recurrence_frequency_label(""), None);
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
}
