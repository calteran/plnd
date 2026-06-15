//! Pure decision logic for the device-affirm path (spec D9).
//!
//! Given the user's committed anchor timeline, any in-flight pending
//! observation, the zone the device just reported, and "now", decide what to
//! do — **without performing any I/O**. The caller (the `plnd_api` service)
//! enacts the returned [`DeviceAffirmDecision`] by writing anchors / pending
//! rows. Keeping the policy pure makes every D9 branch a Docker-free unit test.

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use chrono_tz::Tz;

use crate::models::{TimezoneAnchor, TimezoneSource};
use crate::timezone::{governing_anchor, zone_at};

/// A contradicting device reading must be seen on at least this many separate
/// device-affirm calls before a standoff can be raised (≈ "persists across
/// sessions"). Tunable.
pub const CORROBORATION_MIN_OBSERVATIONS: i32 = 2;

/// ...and at least this much time must elapse between the first and current
/// contradicting reading. Together with the count, this prevents a single
/// stale-clock reading on arrival from flipping or flagging the zone. Tunable.
pub const CORROBORATION_MIN_DWELL: Duration = Duration::hours(3);

/// The current pending observation (only the fields the decision needs).
#[derive(Debug, Clone, Copy)]
pub struct PendingState {
    pub observed_zone: Tz,
    pub observation_count: i32,
    pub first_seen: DateTime<Utc>,
    pub standoff_raised: bool,
}

/// What the service should do in response to a device reading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceAffirmDecision {
    /// Device matches the currently-effective zone (or no change warranted).
    /// `clear_pending` is true when a stale pending observation should be
    /// deleted because the disagreement has resolved.
    NoOp { clear_pending: bool },
    /// Self-heal: append a `device` anchor at `now`; clear any pending row.
    Append,
    /// Inside a known round-trip bracket: ignore the contradicting reading.
    Distrust,
    /// Open-ended contradiction below threshold: upsert pending with `new_count`.
    Corroborate {
        new_count: i32,
        first_seen: DateTime<Utc>,
    },
    /// Corroboration threshold crossed while the higher-trust zone is still
    /// active: raise the one-time gentle confirm.
    RaiseStandoff {
        new_count: i32,
        first_seen: DateTime<Utc>,
    },
}

/// Decide how to respond to a device reading (spec D9). Pure — no I/O.
///
/// - `anchors`: the user's committed timeline (at least through `now`).
/// - `pending`: the current pending observation, if any.
/// - `reported`: the IANA zone the device just reported.
/// - `now_date` / `now_time`: "now" in the reported zone's wall clock (the
///   position a new `device` anchor would take).
/// - `now_instant`: the absolute instant of this call (for the dwell check).
pub fn decide_device_affirm(
    anchors: &[TimezoneAnchor],
    pending: Option<PendingState>,
    reported: Tz,
    now_date: NaiveDate,
    now_time: NaiveTime,
    now_instant: DateTime<Utc>,
) -> DeviceAffirmDecision {
    let current = zone_at(anchors, now_date, Some(now_time));

    // (1) Match → no-op. Clear a stale pending row for a different zone.
    if current == Some(reported) {
        let clear_pending = pending.is_some_and(|p| p.observed_zone != reported);
        return DeviceAffirmDecision::NoOp { clear_pending };
    }

    // Identify the anchor governing "now" (the one `zone_at` selected) via the
    // shared selection helper, so policy and resolution can never diverge.
    let Some(gov) = governing_anchor(anchors, now_date, Some(now_time)) else {
        return DeviceAffirmDecision::Append; // nothing higher-trust to protect
    };

    // (2) Low-trust governing anchor (device) → normal self-heal append.
    if gov.source == TimezoneSource::Device {
        return DeviceAffirmDecision::Append;
    }

    // Higher-trust governing anchor. Bracket vs open-ended: inside a bracket
    // iff it shares an inference_group with a later (future) anchor.
    if let Some(group) = gov.inference_group {
        let has_future_return = anchors.iter().any(|a| {
            a.inference_group == Some(group)
                && (a.effective_date, a.effective_time) > (now_date, Some(now_time))
        });
        if has_future_return {
            return DeviceAffirmDecision::Distrust;
        }
    }

    // (4) Open-ended higher-trust assertion → require corroboration.
    if let Some(p) = pending
        && p.standoff_raised
        && p.observed_zone == reported
    {
        return DeviceAffirmDecision::NoOp {
            clear_pending: false,
        };
    }

    let (new_count, first_seen) = match pending {
        Some(p) if p.observed_zone == reported => (p.observation_count + 1, p.first_seen),
        _ => (1, now_instant),
    };

    let dwell_ok = now_instant - first_seen >= CORROBORATION_MIN_DWELL;
    if new_count >= CORROBORATION_MIN_OBSERVATIONS && dwell_ok {
        DeviceAffirmDecision::RaiseStandoff {
            new_count,
            first_seen,
        }
    } else {
        DeviceAffirmDecision::Corroborate {
            new_count,
            first_seen,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TimezoneSource;
    use chrono::TimeZone;
    use chrono_tz::America::{Chicago, Denver, New_York};
    use uuid::Uuid;

    /// Build an anchor with full control over the fields the decision reads.
    fn anchor(
        date: NaiveDate,
        time: Option<NaiveTime>,
        zone: Tz,
        source: TimezoneSource,
        inference_group: Option<Uuid>,
        created_at: DateTime<Utc>,
    ) -> TimezoneAnchor {
        TimezoneAnchor {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            effective_date: date,
            effective_time: time,
            zone,
            source,
            source_ref: None,
            inference_group,
            created_at,
            updated_at: created_at,
        }
    }

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn t(h: u32, min: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, min, 0).unwrap()
    }

    fn ts(y: i32, m: u32, day: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, day, h, min, 0).unwrap()
    }

    // ---- (1) Match → no-op ----------------------------------------------

    #[test]
    fn match_is_noop() {
        let anchors = [anchor(
            d(2026, 1, 1),
            None,
            New_York,
            TimezoneSource::User,
            None,
            ts(2026, 1, 1, 0, 0),
        )];
        let got = decide_device_affirm(
            &anchors,
            None,
            New_York,
            d(2026, 6, 1),
            t(9, 0),
            ts(2026, 6, 1, 13, 0),
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::NoOp {
                clear_pending: false
            }
        );
    }

    #[test]
    fn match_clears_stale_pending() {
        // Current zone matches the device, but a pending observation exists for
        // a different (now-resolved) zone → clear it.
        let anchors = [anchor(
            d(2026, 1, 1),
            None,
            New_York,
            TimezoneSource::User,
            None,
            ts(2026, 1, 1, 0, 0),
        )];
        let pending = PendingState {
            observed_zone: Denver,
            observation_count: 2,
            first_seen: ts(2026, 5, 30, 0, 0),
            standoff_raised: false,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York,
            d(2026, 6, 1),
            t(9, 0),
            ts(2026, 6, 1, 13, 0),
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::NoOp {
                clear_pending: true
            }
        );
    }

    // ---- (3) No higher-trust conflict → append -------------------------

    #[test]
    fn differs_no_conflict_appends() {
        // Governing anchor is Device; the device now reports a different zone.
        let anchors = [anchor(
            d(2026, 1, 1),
            None,
            New_York,
            TimezoneSource::Device,
            None,
            ts(2026, 1, 1, 0, 0),
        )];
        let got = decide_device_affirm(
            &anchors,
            None,
            Denver,
            d(2026, 6, 1),
            t(9, 0),
            ts(2026, 6, 1, 15, 0),
        );
        assert_eq!(got, DeviceAffirmDecision::Append);
    }

    #[test]
    fn differs_no_governing_anchor_appends() {
        // No anchor at or before "now" → nothing higher-trust to protect.
        let anchors = [anchor(
            d(2026, 12, 1),
            None,
            New_York,
            TimezoneSource::User,
            None,
            ts(2026, 1, 1, 0, 0),
        )];
        let got = decide_device_affirm(
            &anchors,
            None,
            Denver,
            d(2026, 6, 1),
            t(9, 0),
            ts(2026, 6, 1, 15, 0),
        );
        assert_eq!(got, DeviceAffirmDecision::Append);
    }

    // ---- (4a) Inside a round-trip bracket → distrust -------------------

    #[test]
    fn in_bracket_distrusts() {
        let group = Uuid::new_v4();
        let anchors = [
            // Governing: inferred trip leg in effect now.
            anchor(
                d(2026, 6, 1),
                None,
                Denver,
                TimezoneSource::Inferred,
                Some(group),
                ts(2026, 5, 1, 0, 0),
            ),
            // Future return leg in the same group → bracket still open.
            anchor(
                d(2026, 6, 10),
                None,
                New_York,
                TimezoneSource::Inferred,
                Some(group),
                ts(2026, 5, 1, 0, 0),
            ),
        ];
        let got = decide_device_affirm(
            &anchors,
            None,
            New_York, // contradicting reading
            d(2026, 6, 5),
            t(9, 0),
            ts(2026, 6, 5, 15, 0),
        );
        assert_eq!(got, DeviceAffirmDecision::Distrust);
    }

    // ---- (4b) Open-ended higher-trust → corroborate --------------------

    #[test]
    fn open_ended_first_contradiction_records() {
        let group = Uuid::new_v4();
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::Inferred,
            Some(group), // group, but no future member → one-way
            ts(2026, 5, 1, 0, 0),
        )];
        let got = decide_device_affirm(
            &anchors,
            None,
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            ts(2026, 6, 5, 15, 0),
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 1,
                first_seen: ts(2026, 6, 5, 15, 0),
            }
        );
    }

    #[test]
    fn open_ended_count_met_but_dwell_not_records() {
        // Pending count 1, same zone, first_seen only 1h before now → dwell
        // unmet, so increment to 2 but do NOT raise a standoff.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::Inferred,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let now = ts(2026, 6, 5, 15, 0);
        let pending = PendingState {
            observed_zone: New_York,
            observation_count: 1,
            first_seen: now - Duration::hours(1),
            standoff_raised: false,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            now,
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 2,
                first_seen: now - Duration::hours(1),
            }
        );
    }

    #[test]
    fn open_ended_corroborated_raises_standoff() {
        // Pending count 1, same zone, first_seen 4h before now → both count and
        // dwell satisfied → raise the one-time standoff.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::Inferred,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let now = ts(2026, 6, 5, 15, 0);
        let pending = PendingState {
            observed_zone: New_York,
            observation_count: 1,
            first_seen: now - Duration::hours(4),
            standoff_raised: false,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            now,
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::RaiseStandoff {
                new_count: 2,
                first_seen: now - Duration::hours(4),
            }
        );
    }

    #[test]
    fn standoff_not_reraised() {
        // A standoff was already raised for this disagreement → no-op, keep the
        // pending row.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::Inferred,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let now = ts(2026, 6, 5, 15, 0);
        let pending = PendingState {
            observed_zone: New_York,
            observation_count: 3,
            first_seen: now - Duration::hours(10),
            standoff_raised: true,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            now,
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::NoOp {
                clear_pending: false
            }
        );
    }

    #[test]
    fn standoff_raised_third_zone_resets() {
        // A standoff was already raised for zone X (count 3). The device now
        // reports a THIRD zone Y (≠ X, ≠ current). The standoff short-circuit
        // only fires when observed_zone == reported, so it does NOT fire here:
        // a brand-new disagreement falls through to the reset branch rather
        // than being silently swallowed as a no-op.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver, // current/governing zone
            TimezoneSource::Inferred,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let now = ts(2026, 6, 5, 15, 0);
        let pending = PendingState {
            observed_zone: Chicago, // X — the zone the standoff was raised for
            observation_count: 3,
            first_seen: now - Duration::hours(10),
            standoff_raised: true,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York, // Y — a third, contradicting zone (≠ Chicago, ≠ Denver)
            d(2026, 6, 5),
            t(9, 0),
            now,
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 1,
                first_seen: now,
            }
        );
    }

    #[test]
    fn pending_different_zone_resets_count() {
        // Pending for zone X (count 3); device now reports a different
        // contradicting zone Y → count resets to 1, first_seen becomes now.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::Inferred,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let now = ts(2026, 6, 5, 15, 0);
        let pending = PendingState {
            observed_zone: Chicago, // X
            observation_count: 3,
            first_seen: now - Duration::hours(10),
            standoff_raised: false,
        };
        let got = decide_device_affirm(
            &anchors,
            Some(pending),
            New_York, // Y, also contradicting Denver
            d(2026, 6, 5),
            t(9, 0),
            now,
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 1,
                first_seen: now,
            }
        );
    }

    // ---- Extra: User-sourced open-ended behaves like Inferred ----------

    #[test]
    fn open_ended_user_source_corroborates() {
        // A user override (highest trust) with no future bracket member behaves
        // identically to the inferred open-ended path: require corroboration.
        let anchors = [anchor(
            d(2026, 6, 1),
            None,
            Denver,
            TimezoneSource::User,
            None,
            ts(2026, 5, 1, 0, 0),
        )];
        let got = decide_device_affirm(
            &anchors,
            None,
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            ts(2026, 6, 5, 15, 0),
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 1,
                first_seen: ts(2026, 6, 5, 15, 0),
            }
        );
    }

    // ---- Extra: a PAST group member does not form a bracket ------------

    #[test]
    fn past_group_member_is_open_ended() {
        // Governing inferred anchor shares a group with an EARLIER anchor only
        // (the return already happened). No future return → open-ended, not a
        // bracket, so we corroborate rather than distrust.
        let group = Uuid::new_v4();
        let anchors = [
            anchor(
                d(2026, 5, 20),
                None,
                New_York,
                TimezoneSource::Inferred,
                Some(group),
                ts(2026, 5, 1, 0, 0),
            ),
            anchor(
                d(2026, 6, 1),
                None,
                Denver,
                TimezoneSource::Inferred,
                Some(group),
                ts(2026, 5, 1, 0, 0),
            ),
        ];
        let got = decide_device_affirm(
            &anchors,
            None,
            New_York,
            d(2026, 6, 5),
            t(9, 0),
            ts(2026, 6, 5, 15, 0),
        );
        assert_eq!(
            got,
            DeviceAffirmDecision::Corroborate {
                new_count: 1,
                first_seen: ts(2026, 6, 5, 15, 0),
            }
        );
    }
}
