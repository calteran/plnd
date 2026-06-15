# Timezone Signals Implementation Plan (#930)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the timezone timeline from real signals — the **device** (with D9 stale-clock conservatism) and the **agent's confidence-gated travel inference (D4)** — by *writing the right anchors*. No display work (that is sub-issue #931).

**Architecture:** Two independent backend capabilities, both writing `TimezoneAnchor` rows through the existing `TimezoneAnchorRepository` from #929. (A) A device-affirm path: a pure decision function in `plnd_data::timezone` enacted by a `plnd_api` service + endpoint, backed by a new `timezone_pending_observations` table that tracks corroboration and the one-time standoff confirm. (B) An `infer_timezone_change` LLM tool in `plnd_agent` registered for `UseCase::TaskEntry`, which the model calls when a task clears the confidence bar.

**Tech Stack:** Rust (Axum `plnd_api`, `plnd_agent`, `plnd_data` with sqlx behind repository traits), `chrono` / `chrono-tz`, `async-trait`. No client work in this issue.

**Design source:** `docs/superpowers/specs/2026-06-15-timezone-handling-design.md` (D3, D4, D9). Foundation merged in #929: `TimezoneAnchor` / `TimezoneSource` models, `TimezoneAnchorRepository` (`list_through`, `add`, `delete`, `delete_group`), pure `zone_at` / `resolve_instant`, and `/timezone/*` routes.

**Two settled implementation decisions (confirmed with the user):**
1. Corroboration/standoff state lives in a **new dedicated table** `timezone_pending_observations` (not a "pending" anchor source, not in-memory).
2. The D4 confidence bar is judged by the **LLM via a tool it calls** (`infer_timezone_change`), guided by prompt + tool description — not a deterministic Rust keyword scan.

**Chosen D9 thresholds (documented in code + spec; tunable):**
- `CORROBORATION_MIN_OBSERVATIONS = 2` — a contradicting device reading must be seen on at least 2 separate device-affirm calls (≈ "persists across sessions").
- `CORROBORATION_MIN_DWELL = chrono::Duration::hours(3)` — and at least 3h must elapse between the first and current contradicting reading. Both conditions must hold before a standoff is raised. A single stale reading (count 1, <3h) can never flip or flag.

---

## Pattern references (mirror these exactly — not placeholders)

The repository layering and route style were established in #929. Implementers MUST open and mirror these sibling files rather than inventing structure:

- **Repository 3-layer + aggregator:** `plnd_data/src/db/timezone_anchor.rs` (raw SQL, `DatabaseError`), `plnd_data/src/repository/timezone_anchor.rs` (trait, domain types only), `plnd_data/src/repository/pg/timezone_anchor.rs` (impl). Registration sites: `plnd_data/src/db/mod.rs`, `plnd_data/src/repository/mod.rs` (trait re-export **and** the `Repositories` struct field + constructor wiring), `plnd_data/src/repository/pg/mod.rs`, `plnd_data/src/models/mod.rs`.
- **Migration shape:** `plnd_data/migrations/0047_timezone_change_anchors.sql`.
- **Model + enum mapping:** `plnd_data/src/models/timezone_anchor.rs` (note: `Tz` is **not** sqlx-decodable, so the `db` layer maps the TEXT column to `Tz` by hand; do the same for `observed_zone`).
- **Pure function + tests:** `plnd_data/src/timezone/mod.rs` (`zone_at` and its `#[cfg(test)] mod tests`).
- **Route handlers + auth:** `plnd_api/src/routes/timezone.rs` (`Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?`, `map_repo_error`, `deserialize_opt_hhmm`), `plnd_api/src/api_response.rs`, `plnd_api/src/main.rs` (route table), `plnd_api/src/openapi.rs`, `plnd_api/src/routes/mod.rs`.
- **Agent tool + registry:** `plnd_agent/src/tools/schedule.rs` (`Tool` impl, `register_*` fn, schema constructor, `db_err` helper), `plnd_agent/src/tools/mod.rs` (`build_tool_registry` `UseCase::TaskEntry` arm), `plnd_agent/src/context/mod.rs` (`TASK_ENTRY_PROMPT` selection).
- **Stub-repo unit test pattern:** `plnd_agent/src/tools/meal.rs` `#[cfg(test)] mod tests` (`StubUserMealPrefRepo`).
- **DB-backed agent test harness:** `plnd_agent/src/agent/mod.rs` `mod tests` — `test_db()` (reads `DATABASE_URL`, returns `None` to skip), `new_user(&repos)`, `MockLlmProvider` (`push_response`, `last_request_handle`), `new_with_registry_and_repos`, `make_registry`.

`just verify` runs `cargo nextest` against the docker `db`, so DB-gated tests (`test_db()` returns `Some`) execute in CI. **Run `just fmt` before any `just verify`** (per CLAUDE.md — `verify` includes `cargo fmt --check`).

---

## Task 1: `timezone_pending_observations` table, model, repository

**Files:**
- Create: `plnd_data/migrations/0048_timezone_pending_observations.sql`
- Create: `plnd_data/src/models/timezone_pending_observation.rs`
- Modify: `plnd_data/src/models/mod.rs`
- Create: `plnd_data/src/db/timezone_pending_observation.rs`
- Modify: `plnd_data/src/db/mod.rs`
- Create: `plnd_data/src/repository/timezone_pending_observation.rs`
- Create: `plnd_data/src/repository/pg/timezone_pending_observation.rs`
- Modify: `plnd_data/src/repository/mod.rs` (re-export trait; add `Repositories` field + constructor wiring)
- Modify: `plnd_data/src/repository/pg/mod.rs`

- [ ] **Step 1: Write the migration.**

```sql
-- 0048_timezone_pending_observations.sql
-- Tracks a single in-flight "contradicting device reading" per user so that a
-- transient/stale device clock cannot immediately override a higher-trust
-- (user/inferred) timezone assertion (spec D9). Corroboration must persist
-- across sessions (observation_count) AND a dwell window before a one-time
-- "gentle confirm" standoff is raised. Promotion to a real timezone anchor or
-- dismissal deletes the row — this table never holds committed timeline state.
CREATE TABLE timezone_pending_observations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- At most one pending observation per user at a time; a newly observed,
    -- different zone replaces the prior row (see repository `upsert`).
    user_id            UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    -- The contradicting IANA zone the device keeps reporting.
    observed_zone      TEXT NOT NULL,
    -- How many separate device-affirm calls have reported this zone.
    observation_count  INTEGER NOT NULL DEFAULT 1,
    first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set exactly once, when the corroboration threshold is crossed and the
    -- one-time gentle confirm is surfaced. NULL = not yet raised. Prevents the
    -- standoff from being re-raised for the same disagreement.
    standoff_raised_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Write the model** `plnd_data/src/models/timezone_pending_observation.rs`, mirroring `timezone_anchor.rs`. Do **not** derive `sqlx::FromRow` (the `observed_zone: Tz` field is mapped by hand in the `db` layer).

```rust
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A single in-flight contradicting device reading for a user (spec D9).
///
/// Maps the `timezone_pending_observations` table (migration 0048). At most one
/// row exists per user. The row is deleted once the disagreement resolves —
/// either it is promoted to a real `user`/`device` anchor, or dismissed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimezonePendingObservation {
    pub id: Uuid,
    pub user_id: Uuid,
    /// The contradicting IANA zone the device keeps reporting.
    pub observed_zone: Tz,
    /// Number of separate device-affirm calls reporting `observed_zone`.
    pub observation_count: i32,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// `Some` once the one-time gentle confirm has been surfaced; `None` before.
    pub standoff_raised_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

Add `pub mod timezone_pending_observation;` + `pub use timezone_pending_observation::TimezonePendingObservation;` to `plnd_data/src/models/mod.rs` (match existing ordering/style).

- [ ] **Step 3: Write the `db` layer** `plnd_data/src/db/timezone_pending_observation.rs`, mirroring `db/timezone_anchor.rs` (same `map_row` hand-mapping of the TEXT zone via `observed_zone.parse::<Tz>()`, same `#[tracing::instrument(skip(pool), fields(table = "timezone_pending_observations", op = "..."))]` style, same `DatabaseError` returns). Functions:
  - `get(pool, user_id) -> Result<Option<TimezonePendingObservation>, DatabaseError>` — `SELECT ... WHERE user_id = $1`.
  - `upsert(pool, user_id, observed_zone: Tz, observation_count, last_seen) -> Result<TimezonePendingObservation, DatabaseError>` — `INSERT ... ON CONFLICT (user_id) DO UPDATE SET observed_zone = EXCLUDED.observed_zone, observation_count = EXCLUDED.observation_count, last_seen = EXCLUDED.last_seen, updated_at = NOW()`. Bind `observed_zone.name()` for the TEXT column. **Note:** the caller decides the count (it has already read the prior row and run the pure decision), so `upsert` writes the count it is given; it does not increment in SQL. On a fresh insert `first_seen`/`created_at` default to `NOW()`; on conflict they are preserved (not in the SET list).
  - `mark_standoff(pool, user_id) -> Result<(), DatabaseError>` — `UPDATE ... SET standoff_raised_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND standoff_raised_at IS NULL` (idempotent — never re-raises).
  - `clear(pool, user_id) -> Result<(), DatabaseError>` — `DELETE ... WHERE user_id = $1`.

  Add `pub mod timezone_pending_observation;` to `plnd_data/src/db/mod.rs`.

- [ ] **Step 4: Write the repository trait** `plnd_data/src/repository/timezone_pending_observation.rs` (domain types + `crate::Error` only, no sqlx):

```rust
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use uuid::Uuid;

use crate::models::TimezonePendingObservation;

#[async_trait]
pub trait TimezonePendingObservationRepository: Send + Sync {
    /// The user's current pending observation, if any.
    async fn get(
        &self,
        user_id: Uuid,
    ) -> Result<Option<TimezonePendingObservation>, crate::Error>;

    /// Insert or replace the user's pending observation with the given count
    /// and `last_seen`. `first_seen` is preserved on update, defaulted on insert.
    async fn upsert(
        &self,
        user_id: Uuid,
        observed_zone: Tz,
        observation_count: i32,
        last_seen: DateTime<Utc>,
    ) -> Result<TimezonePendingObservation, crate::Error>;

    /// Set `standoff_raised_at` once (idempotent — no-op if already set).
    async fn mark_standoff(&self, user_id: Uuid) -> Result<(), crate::Error>;

    /// Delete the user's pending observation (on resolution/dismissal/match).
    async fn clear(&self, user_id: Uuid) -> Result<(), crate::Error>;
}
```

- [ ] **Step 5: Write the pg impl** `plnd_data/src/repository/pg/timezone_pending_observation.rs`, mirroring `pg/timezone_anchor.rs` (`PgTimezonePendingObservationRepository { pool: PgPool }`, `new(pool)`, `#[async_trait]` delegating each method to the `db::timezone_pending_observation` fn, mapping `DatabaseError` → `crate::Error` exactly as the sibling does). Add `pub mod timezone_pending_observation;` to `plnd_data/src/repository/pg/mod.rs`.

- [ ] **Step 6: Register in the aggregator.** In `plnd_data/src/repository/mod.rs`: re-export the trait (mirror the `timezone_anchor` re-export line); add a `pub timezone_pending_observation: Arc<dyn TimezonePendingObservationRepository>` field to `Repositories`; wire it in the constructor (`timezone_pending_observation: Arc::new(pg::timezone_pending_observation::PgTimezonePendingObservationRepository::new(pool.clone()))`).

- [ ] **Step 7: Compile check.** Run: `just verify-build`. Expected: clean compile (no server run).

- [ ] **Step 8: Commit.**

```bash
git add plnd_data/migrations/0048_timezone_pending_observations.sql plnd_data/src/models/ plnd_data/src/db/ plnd_data/src/repository/
git commit -m "feat(timezone): pending-observation table + repository for D9 corroboration"
```

---

## Task 2: Pure `decide_device_affirm` D9 decision function

**Files:**
- Create: `plnd_data/src/timezone/device.rs`
- Modify: `plnd_data/src/timezone/mod.rs` (add `pub mod device;` and re-export the public items)

This is the heart of D9 — pure, DB-free, exhaustively unit-tested (no Docker). Write the tests **first** (TDD).

- [ ] **Step 1: Define the public types and thresholds** in `plnd_data/src/timezone/device.rs`.

```rust
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
use crate::timezone::zone_at;

/// A contradicting device reading must be seen on at least this many separate
/// device-affirm calls before a standoff can be raised (≈ "persists across
/// sessions"). Tunable.
pub const CORROBORATION_MIN_OBSERVATIONS: i32 = 2;

/// ...and at least this much time must elapse between the first and current
/// contradicting reading. Together with the count, this prevents a single
/// stale-clock reading on arrival from flipping or flagging the zone. Tunable.
pub const CORROBORATION_MIN_DWELL: Duration = Duration::hours(3);

/// The current pending observation, as read from
/// `TimezonePendingObservation` (only the fields the decision needs).
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
    /// Inside a known round-trip bracket: ignore the contradicting reading
    /// entirely (no anchor, no pending change).
    Distrust,
    /// Open-ended contradiction below threshold: upsert the pending row with
    /// `new_count` and refreshed `last_seen`. No anchor written.
    Corroborate { new_count: i32 },
    /// Corroboration threshold crossed while the higher-trust zone is still
    /// active: raise the one-time gentle confirm. Service calls `mark_standoff`
    /// (idempotent) and returns the confirm payload to the client.
    RaiseStandoff { new_count: i32 },
}
```

- [ ] **Step 2: Write the failing tests** in a `#[cfg(test)] mod tests` block. Use the `anchor(...)` / `d(...)` / `t(...)` helper style from `timezone/mod.rs`. Cover every branch (these ARE the acceptance criteria for the device logic):

  1. `match_is_noop` — device reports the currently-effective zone → `NoOp { clear_pending: false }`.
  2. `match_clears_stale_pending` — current zone matches device, but a pending row for a *different* zone exists → `NoOp { clear_pending: true }`.
  3. `differs_no_conflict_appends` — governing anchor is `device` (or none higher-trust), device differs → `Append`.
  4. `in_bracket_distrusts` — governing anchor is `inferred`/`user` and shares an `inference_group` with a later (future-dated) anchor (round-trip return still ahead); device reports a contradicting zone → `Distrust`.
  5. `open_ended_first_contradiction_records` — governing anchor `inferred` one-way (group, but no future member), no pending → `Corroborate { new_count: 1 }`.
  6. `open_ended_second_contradiction_below_dwell_records` — pending exists `observation_count: 1`, same zone, but `first_seen` only 1h ago → `Corroborate { new_count: 2 }` (count met but dwell not) — **no standoff**.
  7. `open_ended_corroborated_raises_standoff` — pending `observation_count: 1`, same zone, `first_seen` 4h ago → reaching count 2 AND dwell ≥ 3h → `RaiseStandoff { new_count: 2 }`.
  8. `standoff_not_reraised` — pending `standoff_raised: true`, still contradicting → `NoOp { clear_pending: false }` (do not append, do not re-flag).
  9. `pending_zone_change_resets_count` — pending exists for zone X, device now reports a *different* contradicting zone Y → `Corroborate { new_count: 1 }` (count resets, not increments).

  Run: `cargo nextest run -p plnd_data device::` (or `just verify-build` then targeted). Expected: FAIL (function not yet implemented).

- [ ] **Step 3: Implement `decide_device_affirm`.**

```rust
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

    // Identify the anchor governing "now" (the one `zone_at` selected): the
    // most recent at or before (now_date, now_time), tie-broken by created_at.
    let governing = anchors
        .iter()
        .filter(|a| (a.effective_date, a.effective_time) <= (now_date, Some(now_time)))
        .max_by_key(|a| (a.effective_date, a.effective_time, a.created_at));

    let Some(gov) = governing else {
        // No governing anchor at all — nothing higher-trust to protect.
        return DeviceAffirmDecision::Append;
    };

    // (2) Governing anchor is low-trust (device) → normal self-heal append.
    if gov.source == TimezoneSource::Device {
        return DeviceAffirmDecision::Append;
    }

    // Governing anchor is higher-trust (user/inferred). Bracket vs open-ended:
    // inside a bracket iff it shares an inference_group with a later anchor
    // (a known round-trip return still lies ahead of now).
    if let Some(group) = gov.inference_group {
        let has_future_return = anchors.iter().any(|a| {
            a.inference_group == Some(group)
                && (a.effective_date, a.effective_time) > (now_date, Some(now_time))
        });
        if has_future_return {
            // (3) In-bracket contradiction → distrust (stale arrival reading).
            return DeviceAffirmDecision::Distrust;
        }
    }

    // (4) Open-ended higher-trust assertion → require corroboration.
    // If a standoff was already raised for this disagreement, do not re-raise.
    if let Some(p) = pending {
        if p.standoff_raised && p.observed_zone == reported {
            return DeviceAffirmDecision::NoOp { clear_pending: false };
        }
    }

    let (new_count, first_seen) = match pending {
        Some(p) if p.observed_zone == reported => (p.observation_count + 1, p.first_seen),
        // No pending, or pending for a different zone → reset to this reading.
        _ => (1, now_instant),
    };

    let dwell_ok = now_instant - first_seen >= CORROBORATION_MIN_DWELL;
    if new_count >= CORROBORATION_MIN_OBSERVATIONS && dwell_ok {
        DeviceAffirmDecision::RaiseStandoff { new_count }
    } else {
        DeviceAffirmDecision::Corroborate { new_count }
    }
}
```

- [ ] **Step 4: Wire the module.** In `plnd_data/src/timezone/mod.rs` add `pub mod device;` near the top and (optionally) `pub use device::{decide_device_affirm, DeviceAffirmDecision, PendingState, CORROBORATION_MIN_DWELL, CORROBORATION_MIN_OBSERVATIONS};`.

- [ ] **Step 5: Run tests to verify they pass.** Run: `just fmt` then `cargo nextest run -p plnd_data`. Expected: all device + existing `zone_at`/`resolve_instant` tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add plnd_data/src/timezone/
git commit -m "feat(timezone): pure D9 device-affirm decision function + tests"
```

---

## Task 3: `plnd_api` device-affirm service + endpoints

**Files:**
- Modify: `plnd_api/src/routes/timezone.rs` (add handlers + request/response types; clear pending on user-anchor create)
- Modify: `plnd_api/src/api_response.rs` (if a shared response type is needed — otherwise keep types local to the route module, matching `ResolveResponse`)
- Modify: `plnd_api/src/main.rs` (register routes)
- Modify: `plnd_api/src/openapi.rs` (register new paths + schemas)

Endpoints:
- `POST /timezone/device` — body `{ zone: String }`; the client calls this on app load. Enacts the D9 decision.
- `POST /timezone/standoff/dismiss` — clears the pending observation without creating an anchor (the "device clock is just off" resolution).
- (Modify existing `create_anchor`) — after a successful `user` anchor insert, call `timezone_pending_observation.clear(user_id)` so picking a zone resolves any standoff.

- [ ] **Step 1: Add request/response types** to `plnd_api/src/routes/timezone.rs` (mirror the existing `#[derive(Debug, Deserialize/Serialize, utoipa::ToSchema)]` style):

```rust
/// Request body for `POST /timezone/device`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DeviceAffirmRequest {
    /// IANA zone reported by the device (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
    pub zone: String,
}

/// Outcome of a device-affirm call.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAffirmOutcome {
    /// No change (device matched, or inside a distrusted bracket, or standoff
    /// already raised).
    NoChange,
    /// A `device` anchor was appended (self-heal).
    Appended,
    /// Contradiction recorded toward corroboration; no change yet.
    Recording,
    /// The one-time gentle confirm was raised; `confirm` is populated.
    Standoff,
}

/// Response for `POST /timezone/device`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeviceAffirmResponse {
    pub outcome: DeviceAffirmOutcome,
    /// The IANA zone in effect at "now" after the call (or `null` if none).
    pub effective_zone: Option<String>,
    /// Populated only when `outcome == standoff`.
    pub confirm: Option<StandoffConfirm>,
}

/// The payload the client uses to render the one-time gentle confirm (D9).
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct StandoffConfirm {
    /// The higher-trust zone currently in effect (what we believe).
    pub intended_zone: String,
    /// The zone the device keeps reporting.
    pub device_zone: String,
}
```

- [ ] **Step 2: Implement the `device_affirm` handler.** Auth + repo access mirror `create_anchor`. Steps inside:
  1. Parse `body.zone` → `Tz` (`zone.parse::<chrono_tz::Tz>()`); on error return `StatusCode::BAD_REQUEST` (match the existing zone-validation behavior in `create_anchor`).
  2. Compute `now`: `let now_instant = Utc::now(); let local = now_instant.with_timezone(&reported); let now_date = local.date_naive(); let now_time = local.time();`
  3. Load anchors: `state.repos.timezone_anchor.list_through(user_id, now_date).await` → `map_repo_error`.
  4. Load pending: `state.repos.timezone_pending_observation.get(user_id).await?` → build `Option<PendingState>` (`standoff_raised: row.standoff_raised_at.is_some()`).
  5. `let decision = plnd_data::timezone::decide_device_affirm(&anchors, pending, reported, now_date, now_time, now_instant);`
  6. Enact:
     - `NoOp { clear_pending }` → if `clear_pending` call `.clear(user_id)`; outcome `NoChange`.
     - `Append` → `timezone_anchor.add(user_id, now_date, Some(now_time), reported, TimezoneSource::Device, None, None)`; `.clear(user_id)` (drop any pending); outcome `Appended`.
     - `Distrust` → no writes; outcome `NoChange`.
     - `Corroborate { new_count }` → `.upsert(user_id, reported, new_count, now_instant)`; outcome `Recording`.
     - `RaiseStandoff { new_count }` → `.upsert(user_id, reported, new_count, now_instant)` then `.mark_standoff(user_id)`; outcome `Standoff` with `confirm = Some(StandoffConfirm { intended_zone: current_zone, device_zone: reported.name() })`.
  7. `effective_zone` = `zone_at(&anchors_after, now_date, Some(now_time))` mapped to `.name().to_string()`. (For `Append`, recompute including the new anchor, or simply set to `reported.name()`. For all others, the pre-existing effective zone.) Keep it simple: `Append` → `Some(reported.name())`; otherwise `zone_at(&anchors, now_date, Some(now_time)).map(|z| z.name().to_string())`.

  Return `Ok(Json(DeviceAffirmResponse { ... }))`.

- [ ] **Step 3: Implement `dismiss_standoff` handler** — auth as above; `state.repos.timezone_pending_observation.clear(user_id).await` → `map_repo_error`; return `StatusCode::NO_CONTENT`.

- [ ] **Step 4: Clear pending on user-anchor create.** In the existing `create_anchor` handler, after the successful `add`, call `state.repos.timezone_pending_observation.clear(user_id).await` (ignore "not found"; `clear` is a DELETE and is naturally idempotent). Add a one-line comment: picking a zone resolves any pending standoff (D9).

- [ ] **Step 5: Register routes** in `plnd_api/src/main.rs`:

```rust
.route("/timezone/device", post(timezone::device_affirm))
.route("/timezone/standoff/dismiss", post(timezone::dismiss_standoff))
```

(Place alongside the existing `/timezone/*` routes; import `post` if not already.)

- [ ] **Step 6: Register OpenAPI** — add `#[utoipa::path(...)]` attributes to both handlers (mirror the existing ones in this file) and add the handlers + new schemas (`DeviceAffirmRequest`, `DeviceAffirmResponse`, `DeviceAffirmOutcome`, `StandoffConfirm`) to `plnd_api/src/openapi.rs`.

- [ ] **Step 7: Add request/response serde unit tests** in the route module's `#[cfg(test)] mod tests` (mirror the existing `CreateTimezoneAnchorRequest` serde test): `DeviceAffirmRequest` parses `{"zone":"America/Denver"}`; `DeviceAffirmResponse`/`DeviceAffirmOutcome` serialize with the expected snake_case tags; `StandoffConfirm` round-trips.

- [ ] **Step 8: Compile + targeted tests.** Run: `just fmt` then `just verify-build`, then `cargo nextest run -p plnd_api timezone`. Expected: clean compile, tests pass.

- [ ] **Step 9: Commit.**

```bash
git add plnd_api/src/
git commit -m "feat(timezone): device-affirm + standoff endpoints enacting D9 policy"
```

---

## Task 4: `infer_timezone_change` agent tool (D4)

**Files:**
- Create: `plnd_agent/src/tools/timezone.rs`
- Modify: `plnd_agent/src/tools/mod.rs` (module decl, re-export, register in `UseCase::TaskEntry` arm)
- Modify: `plnd_agent/Cargo.toml` (add `chrono-tz` — now genuinely used, resolving the #929 machete deferral)
- Modify: `plnd_agent/src/prompts/` — the `TASK_ENTRY_PROMPT` source (find via `plnd_agent/src/context/mod.rs:431`), to add confidence-bar guidance.

- [ ] **Step 1: Implement the tool** in `plnd_agent/src/tools/timezone.rs`, mirroring `CreateTaskTool` in `schedule.rs` (struct holding `Arc<dyn TimezoneAnchorRepository>`, `Tool` impl, `db_err` helper, schema constructor). `user_id` comes from `ctx`, never from input.

```rust
use std::sync::Arc;

use chrono::{NaiveDate, NaiveTime};
use plnd_data::models::TimezoneSource;
use plnd_data::repository::TimezoneAnchorRepository;
use uuid::Uuid;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

pub struct InferTimezoneChangeTool(pub Arc<dyn TimezoneAnchorRepository>);

#[async_trait::async_trait]
impl Tool for InferTimezoneChangeTool {
    fn name(&self) -> &str {
        "infer_timezone_change"
    }

    fn description(&self) -> &str {
        "Record an upcoming timezone change implied by a travel task. ONLY call this \
         when the task EXPLICITLY indicates travel that changes the user's timezone — a \
         flight, a hotel/lodging booking, or a clearly stated destination with a date. \
         Do NOT call it for a passing mention of a city, a phone/video call to another \
         zone, shipping, or vague/aspirational travel. For a known round trip, provide \
         the return_* fields so both the departure and return are recorded together. \
         When in doubt, do not call this tool — the user's device remains the source of \
         truth and corrects any guess."
    }

    fn schema(&self) -> serde_json::Value {
        infer_timezone_change_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let name = self.name();
        let dest_zone = parse_zone(&input, "destination_zone", name)?;
        let effective_date = parse_date(&input, "effective_date", name)?;
        let effective_time = parse_opt_time(&input, "effective_time", name)?;
        let source_ref = parse_opt_uuid(&input, "source_task_id", name)?;

        // Every inferred anchor carries an inference_group so a single
        // correction (D5) removes the whole inference via delete_group —
        // uniformly for one-way and round-trip.
        let group = Uuid::new_v4();

        self.0
            .add(ctx.user_id, effective_date, effective_time, dest_zone,
                 TimezoneSource::Inferred, source_ref, Some(group))
            .await
            .map_err(|e| db_err(name, e))?;

        let mut created = 1;
        // Round trip: a return zone + date creates the paired return anchor.
        if let Some(return_zone) = parse_opt_zone(&input, "return_zone", name)? {
            let return_date = parse_date(&input, "return_date", name)?;
            let return_time = parse_opt_time(&input, "return_time", name)?;
            self.0
                .add(ctx.user_id, return_date, return_time, return_zone,
                     TimezoneSource::Inferred, source_ref, Some(group))
                .await
                .map_err(|e| db_err(name, e))?;
            created = 2;
        }

        Ok(serde_json::json!({
            "inference_group": group.to_string(),
            "anchors_created": created,
        }))
    }
}
```

Implement the small parse helpers (`parse_zone`/`parse_opt_zone` returning `ToolError::InvalidInput` on a non-`Tz` string; `parse_date` via `NaiveDate::parse`; `parse_opt_time` via `%H:%M`; `parse_opt_uuid`) and `db_err` locally (copy the `db_err` from `schedule.rs`). The tool is **non-terminal** (default `is_terminal()` = false).

- [ ] **Step 2: Schema constructor.**

```rust
fn infer_timezone_change_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["destination_zone", "effective_date"],
        "properties": {
            "destination_zone": { "type": "string",
                "description": "IANA zone at the destination, e.g. \"America/Denver\"." },
            "effective_date": { "type": "string", "format": "date",
                "description": "Date the destination timezone takes effect (arrival), YYYY-MM-DD." },
            "effective_time": { "type": "string",
                "description": "Optional local wall-clock time of the switch, HH:MM." },
            "return_zone": { "type": "string",
                "description": "For a round trip, the IANA zone on return (often the origin)." },
            "return_date": { "type": "string", "format": "date",
                "description": "Required if return_zone is given: the return date, YYYY-MM-DD." },
            "return_time": { "type": "string", "description": "Optional return switch time, HH:MM." },
            "source_task_id": { "type": "string", "format": "uuid",
                "description": "ID of the task this travel was inferred from, if known." }
        }
    })
}
```

- [ ] **Step 3: Register the tool.** In `plnd_agent/src/tools/mod.rs`: add `pub(crate) mod timezone;` + `pub(crate) use timezone::register_timezone_inference_tools;` (write a `register_timezone_inference_tools(registry, Arc<dyn TimezoneAnchorRepository>)` fn in `timezone.rs` mirroring `register_schedule_tools`). In the `UseCase::TaskEntry` arm of `build_tool_registry`, after `register_schedule_tools(...)`, add:

```rust
register_timezone_inference_tools(&mut registry, Arc::clone(&repos.timezone_anchor));
```

- [ ] **Step 4: Add `chrono-tz` to `plnd_agent/Cargo.toml`** (version `0.10`, matching `plnd_data`/`plnd_api`; no serde feature needed unless used). It is now genuinely referenced (`parse_zone` → `chrono_tz::Tz`), so `cargo machete` will pass.

- [ ] **Step 5: Add confidence-bar prompt guidance.** Locate the `TASK_ENTRY_PROMPT` constant (referenced at `plnd_agent/src/context/mod.rs:431`). Append a short paragraph instructing the model: when a task explicitly describes travel (flight, hotel, dated destination) that changes timezone, call `infer_timezone_change` with the destination zone and date (and the return pair for a known round trip); for a mere mention of a place, do nothing. Keep it terse and consistent with the prompt's existing voice.

- [ ] **Step 6: Stub-repo + schema unit tests** in `#[cfg(test)] mod tests` in `timezone.rs` (mirror `StubUserMealPrefRepo` in `meal.rs`): write a `StubTimezoneAnchorRepo` capturing `add` calls into a `Mutex<Vec<...>>`.
  - `schema_has_no_user_id` / `schema_requires_destination_and_date`.
  - `oneway_creates_single_anchor_with_group` — execute with only destination → 1 captured `add`, `source = Inferred`, `inference_group = Some(_)`.
  - `roundtrip_creates_pair_sharing_group` — execute with return_* → 2 captured `add`s, identical `inference_group`, `source_ref` threaded to both.
  - `invalid_zone_is_rejected` — `destination_zone: "Not/AZone"` → `ToolError::InvalidInput`.
  - `tool_is_non_terminal`.

  Run: `just fmt` then `cargo nextest run -p plnd_agent timezone`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add plnd_agent/
git commit -m "feat(timezone): infer_timezone_change agent tool (D4 confidence-gated)"
```

---

## Task 5: DB-backed agent integration test (D4 acceptance)

**Files:**
- Modify: `plnd_agent/src/agent/mod.rs` (add tests to the existing `#[cfg(test)] mod tests`, reusing `test_db()`, `new_user()`, `MockLlmProvider`, `make_registry`, `new_with_registry_and_repos`).

This is the **fixture-backed Rust integration test** the acceptance criteria require (per the e2e mock policy — agent logic is exercised in Rust, not the browser). It runs against the docker `db` during `just verify` and self-skips when `DATABASE_URL` is unset.

- [ ] **Step 1: Add a `TaskEntry` registry helper if needed.** `make_registry` currently wires a fixed registry; add a sibling `make_task_entry_registry(mock, repos)` (or extend `new_with_registry_and_repos` usage) that builds the registry via `build_tool_registry(&UseCase::TaskEntry, &repos, None)` so the real `infer_timezone_change` tool (backed by the real `timezone_anchor` repo) is present. Follow the existing harness's construction of `AgentService`.

- [ ] **Step 2: Test — round-trip travel task creates the anchor pair.**

```rust
#[tokio::test]
async fn test_infer_timezone_change_creates_anchor_pair() {
    let repos = match test_db().await { Some(r) => r, None => return };
    let user_id = new_user(&repos).await;

    // Script the model to call infer_timezone_change for a round-trip flight,
    // then end the turn (mirrors how a real model would clear the D4 bar).
    let mock = MockLlmProvider::new("test");
    mock.push_response(CompletionResponse {
        content: None,
        tool_calls: vec![/* tool_call: name "infer_timezone_change",
            input { destination_zone:"America/Denver", effective_date:"2026-07-10",
                    return_zone:"America/New_York", return_date:"2026-07-17" } */],
        stop_reason: StopReason::ToolUse,
        usage: None,
    });
    mock.push_response(CompletionResponse {
        content: Some("Recorded your trip.".into()),
        tool_calls: vec![], stop_reason: StopReason::EndTurn, usage: None,
    });

    let service = /* AgentService over TaskEntry registry backed by `repos` */;
    let ctx = AgentContext {
        user_id, use_case: UseCase::TaskEntry,
        input: "Flight to Denver July 10, back to NYC July 17".into(),
        prior_context: None, extra: None, constrained_to_existing: false,
    };
    service.run(&ctx).await.expect("agent run failed");

    let anchors = repos.timezone_anchor
        .list_through(user_id, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap())
        .await.unwrap();
    let inferred: Vec<_> = anchors.iter()
        .filter(|a| a.source == TimezoneSource::Inferred).collect();
    assert_eq!(inferred.len(), 2, "round trip → depart + return");
    let g0 = inferred[0].inference_group;
    assert!(g0.is_some() && inferred[1].inference_group == g0,
        "both anchors share one inference_group");
}
```

(Construct the `tool_calls` entry using the same `CompletionResponse` / tool-call type the existing tests use — inspect a tool-calling test in this module for the exact struct/fields, e.g. how `place_tasks` or another tool call is scripted.)

- [ ] **Step 3: Test — a run that does not call the tool writes no anchors.**

```rust
#[tokio::test]
async fn test_no_inference_when_tool_not_called() {
    let repos = match test_db().await { Some(r) => r, None => return };
    let user_id = new_user(&repos).await;
    let mock = MockLlmProvider::new("test");
    mock.push_response(CompletionResponse {
        content: Some("Got it.".into()),
        tool_calls: vec![], stop_reason: StopReason::EndTurn, usage: None,
    });
    let service = /* TaskEntry registry over `repos` */;
    let ctx = AgentContext {
        user_id, use_case: UseCase::TaskEntry,
        input: "Call my friend who lives in Denver".into(), // sub-threshold mention
        prior_context: None, extra: None, constrained_to_existing: false,
    };
    service.run(&ctx).await.expect("agent run failed");
    let anchors = repos.timezone_anchor
        .list_through(user_id, NaiveDate::from_ymd_opt(2026,12,31).unwrap())
        .await.unwrap();
    assert!(anchors.is_empty(), "no travel inferred → no anchors");
}
```

- [ ] **Step 4: Test — dismissing an `inference_group` removes both anchors** (exercises `delete_group` from #929 against the inferred pair). Reuse the pair created in Step 2's flow (or re-create inline), then:

```rust
let deleted = repos.timezone_anchor.delete_group(user_id, g0.unwrap()).await.unwrap();
assert_eq!(deleted, 2);
let after = repos.timezone_anchor.list_through(user_id, /* through */).await.unwrap();
assert!(after.iter().all(|a| a.source != TimezoneSource::Inferred));
```

**Note on the confidence bar:** the model's *judgment* (clearing the D4 bar) is governed by the prompt + tool description, not deterministically unit-testable with a mock. These tests verify the wiring and tool behavior (correct pair + group when invoked; nothing when not). This boundary is intentional and documented here so coverage is not silently overstated.

- [ ] **Step 5: Run the DB-backed tests.** Run: `just fmt` then `cargo nextest run -p plnd_agent` (with the stack up / under `just verify`). Expected: the new tests run (DB present) and PASS, existing tests still green.

- [ ] **Step 6: Commit.**

```bash
git add plnd_agent/src/agent/mod.rs
git commit -m "test(timezone): DB-backed agent inference integration tests (D4)"
```

---

## Task 6: Spec/doc update + full verify

**Files:**
- Modify: `docs/superpowers/specs/2026-06-15-timezone-handling-design.md` (record the chosen thresholds + the pending-observation table, replacing the "implementation-plan detail" placeholders in D9/§3).
- Review (likely no change): `docs/architecture.md` §4.8 — it already describes the three signal sources at the abstract level; per the architecture-doc conventions (no code, no process, abstract intent), add at most a single sentence noting device readings are adopted *conservatively* when they contradict a higher-trust assertion, only if §4.8 does not already convey it. Do not add issue/PR/file references.

- [ ] **Step 1: Update the spec.** In D9, replace "Exact bracket/corroboration thresholds are an implementation-plan detail." with the concrete chosen values (2 observations, 3h dwell, bracket = inference-group with a future return). In §3, note the corroboration/standoff state is persisted in a dedicated `timezone_pending_observations` record (one per user; deleted on resolution).

- [ ] **Step 2: Review architecture.md §4.8** and make the minimal/no edit per the conventions above.

- [ ] **Step 3: Full verification.** Run: `just fmt` then `just verify`. Expected: all gates green (fmt, clippy, deny, machete — `chrono-tz` now used in `plnd_agent` — build, ng test, e2e, nextest). Fix any failures and re-run before proceeding.

- [ ] **Step 4: Commit.**

```bash
git add docs/
git commit -m "docs(timezone): record D9 thresholds + pending-observation model (#930)"
```

---

## Final review & handoff

After all tasks: dispatch a final holistic code review over the whole branch (per `feedback_review_before_pr` — review before opening the PR, not after). Then rebase onto `origin/main` and open the PR with `Closes #930`, and invoke `monitor-pr`.

## Self-review notes (author)

- **Spec coverage:** A (device D3/D9) = Tasks 1–3; B (agent D4) = Tasks 4–5; thresholds/table documentation = Task 6. Acceptance criteria mapped: device decision unit tests → Task 2 Step 2 (all five named branches + extras); fixture-backed agent integration test → Task 5; `delete_group` dismissal → Task 5 Step 4; `just verify` green → Task 6 Step 3.
- **Type consistency:** `DeviceAffirmDecision` variants in Task 2 are consumed verbatim in Task 3 Step 2. `PendingState.standoff_raised` is derived from `standoff_raised_at.is_some()` (Task 1 model ↔ Task 2 type). `inference_group` is always `Some(_)` for inferred anchors (Task 4) — matches the bracket-detection logic (Task 2) and the dismissal test (Task 5).
- **Known boundary (not a gap):** the LLM confidence judgment is prompt-governed, not deterministically tested — stated explicitly in Task 5 Step 4.
