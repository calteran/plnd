use chrono::{Datelike, NaiveDate, Weekday};

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
    match freq.as_str() {
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
    match freq.as_str() {
        "WEEKLY" => !rule_uc.contains("BYDAY="),
        "MONTHLY" => {
            let Some(day) = param_value(&rule_uc, "BYMONTHDAY")
                .and_then(|v| v.parse::<u32>().ok())
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
    let Some(pos) = rule_uc.find("BYDAY=") else {
        return false;
    };
    let after = &rule_uc[pos + 6..];
    let byday_value = after.split(';').next().unwrap_or(after);
    let target = date.weekday();
    byday_value
        .split(',')
        .any(|abbrev| weekday_from_abbrev(abbrev.trim()) == Some(target))
}

/// True if `date` matches `rule` (supports legacy simple rules and RRULE BYDAY patterns).
pub(crate) fn date_matches_recurrence(date: NaiveDate, rule: &str) -> bool {
    let rule_lc = rule.to_lowercase();
    match rule_lc.as_str() {
        "daily" => true,
        "weekdays" => date.weekday().num_days_from_monday() < 5,
        "weekends" => date.weekday().num_days_from_monday() >= 5,
        _ if rule_lc.contains("byday=") => byday_matches(date, &rule.to_uppercase()),
        _ => false,
    }
}

/// True if `rule` is a pattern recognised by `date_matches_recurrence`.
pub(crate) fn is_recognised_recurrence(rule: &str) -> bool {
    let rule_lc = rule.to_lowercase();
    matches!(rule_lc.as_str(), "daily" | "weekdays" | "weekends") || rule_lc.contains("byday=")
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

fn param_value(rule_uc: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=");
    rule_uc
        .split(';')
        .find(|p| p.starts_with(needle.as_str()))
        .map(|p| p[needle.len()..].to_string())
}

fn iter_window(start: NaiveDate, end: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    let mut current = start;
    std::iter::from_fn(move || {
        if current > end {
            return None;
        }
        let result = current;
        current = current.succ_opt().unwrap_or(end + chrono::Days::new(1));
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
        assert_eq!(
            dates,
            vec![d(2026, 4, 27), d(2026, 4, 29), d(2026, 5, 1)]
        );
    }

    #[test]
    fn bare_weekly_returns_empty_constrained() {
        let dates = constrained_dates_for_rule("FREQ=WEEKLY", d(2026, 4, 27), d(2026, 5, 3));
        assert!(dates.is_empty());
    }

    #[test]
    fn monthly_returns_empty_constrained() {
        let dates = constrained_dates_for_rule(
            "FREQ=MONTHLY;BYMONTHDAY=15",
            d(2026, 4, 27),
            d(2026, 5, 3),
        );
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
        assert!(!date_matches_recurrence(d(2026, 5, 2), "weekdays")); // Sat
    }

    #[test]
    fn weekends_matches_sat_and_sun_only() {
        assert!(date_matches_recurrence(d(2026, 5, 2), "weekends")); // Sat
        assert!(!date_matches_recurrence(d(2026, 4, 27), "weekends")); // Mon
    }

    #[test]
    fn rrule_byday_mo_matches_mondays_only() {
        assert!(date_matches_recurrence(d(2026, 4, 27), "FREQ=WEEKLY;BYDAY=MO"));
        assert!(!date_matches_recurrence(d(2026, 4, 28), "FREQ=WEEKLY;BYDAY=MO"));
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
