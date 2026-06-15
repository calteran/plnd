# Timezone & Time Handling Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm) — pending implementation plan
**Springboard issue:** [#920](https://github.com/calteran/plnd/issues/920) — *Time handling is inconsistent app-wide; no user-timezone model*

## 1. Problem

PLND has no timezone concept anywhere. The daily-rhythm model (architecture §4.3) is built on wall-clock values (`wake_time`, `sleep_time`, meal `preferred_time`) but only *assumes* a coherent "user's local time" — there is nothing to resolve those clock values against. Concrete defects from #920:

- `schedule_entries.scheduled_start` is `timestamptz` but is round-tripped as **UTC wall-clock** (`week-plan.service.ts` strips UTC `HH:MM`; `deserialize_opt_hhmm` re-reads it as UTC). A non-UTC user persists and sees shifted times. Meal `preferred_time` has the same shape.
- Three inconsistent date-only `Date` construction conventions coexist (noon-UTC, noon-local, midnight-local); the midnight-local sites can shift the calendar day near DST/negative-offset boundaries.

The product goal layered on top of the fix: day-view items must display in the **local time they are expected to occur at**. If today is Monday in one zone but the user will be elsewhere on Friday, Friday's items show in Friday's zone. Timezone management must be **lightweight** (no manual per-user configuration burden) yet **flexible and dynamic** (current zone, usual patterns, and planned future changes such as trips). There must be **no per-user default timezone** — some users split time between multiple homes.

## 2. Decisions

### D1 — Canonical model: wall-clock + resolved zone

Every *planned* time is stored as a literal wall-clock value (date supplies the calendar day, time supplies `HH:MM`). No zone is embedded in the stored value. The applicable zone is **resolved separately** (D2). Absolute UTC instants are computed only at the edge, and only where a global moment is genuinely required: firing notifications, deciding "is it now," and sorting planned items against real elapsed time.

This makes §4.3's daily rhythm correct by construction and removes the #920 UTC round-trip, because we stop pretending wall-clock is UTC.

*Rejected:* storing UTC instants and converting at the edge — correct for fixed global moments but wrong for future intentions, whose wall-clock drifts when the date's zone changes (the #920 bug). Also rejected: a hybrid that uses wall-clock for templates and UTC for dated entries — the two conventions collide at the day-view boundary, which is the inconsistency #920 reports.

### D2 — A timezone change IS an anchor

There is **no separate timezone table or "segment" entity.** A **timezone-change anchor** is a new, fourth source of anchor (joining meal instances, scheduled tasks, and implicit start/end-of-day from §4.7). It carries `(zone, source, source_ref, inference_group)` and participates in the day's ordered anchor sequence like any other anchor.

**Resolution — one rule:** the zone in effect at any point P = the zone of the **most recent timezone-change anchor at or before P** in the ordered anchor sequence (across the whole schedule, not just within one materialized day). If no prior timezone-change anchor exists, there is no resolvable zone — which only happens before onboarding seeds the first one (D6).

Because resolution is purely **positional** (anchor order, which §4.8 establishes is zone-independent), the offset-jump ambiguity that defeats a wall-clock-threshold approach cannot arise: a task is either ordered before or after the timezone-change anchor, regardless of how large or which direction the offset shift is.

Properties this unifies:
- **Whole-day zone.** "What zone does Friday start in?" = the zone of the most recent timezone-change anchor at or before Friday's start-of-day anchor. A day with no intra-day timezone-change anchor resolves entirely to that incoming zone.
- **Intra-day switch (travel day).** A timezone-change anchor placed mid-day (e.g. just after a flight) splits the day: items ordered before it resolve to the prior zone, items ordered at/after it to the new zone.
- **The three signals (D3) are just `source` values** on the same anchor type.

**Anchor characteristics:** the timezone-change anchor is **positional and time-optional** — like elastic anchors in §4.7, its position in the order is what matters, not a precise clock minute. It is **instance-level, not template-derived** (a timezone change is not part of a recurring day-type rhythm) and is **persisted at the schedule level** so a trip three weeks out exists before that date materializes (§4.6 lazy materialization must consult persisted timezone-change anchors when resolving a date's incoming zone).

*Rejected:* a standalone date-grained segment table (loses correct travel-day display, duplicates the ordering machinery the anchor model already provides). A nominal wall-clock cutoff (silently misfiles tasks on backward/large offset jumps, e.g. eastbound-US or transpacific travel).

### D3 — Signals & precedence

Three sources create timezone-change anchors; all do the same thing — append an anchor — so precedence is emergent from ordering, not a lookup table:

- **`device`** — the browser/OS IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), reported on app load. Ground-truth for *now* **when reliable**. The client appends a `device` anchor at the current position **only if** the reported zone differs from the zone currently in effect at "now" (no churn otherwise) **and** the reading is not distrusted under D9.
- **`user`** — an explicit user action (setting or correcting a zone). Wins for the position it names.
- **`inferred`** — created by the agent from a task/calendar item (D4). Only ever fills the unclaimed future.

Because "most recent at-or-before wins," a later higher-trust signal simply supersedes an earlier guess. A wrong future inference self-heals the moment the device reports reality on that date.

### D4 — LLM travel inference (confidence-gated auto-apply)

When the agent reads a task or (future) calendar item that clears a **confidence bar** — an explicit flight, hotel, or stated destination, not a passing mention of a city — it appends `inferred` timezone-change anchor(s) referencing the originating item via `source_ref`. Below the bar it does **nothing**: no prompts, no nagging. The user can always set a zone by hand, and the device remains ground-truth, so an over-eager inference is cheap to reverse.

A known round-trip produces **two** inferred anchors (depart + return), linked by a shared `inference_group` so a single dismissal removes the pair. A one-way or open-ended trip produces one anchor; the device writes the "home again" anchor whenever it next observes the home zone.

### D5 — Day-view surfacing

Same-zone days show **nothing**. Divergence is surfaced quietly:

- **Full divergent day** (no intra-day switch): a zone **chip** on the header (`DENVER · MT`), an orienting **subtext** (`Mountain time · 2h behind your current zone`), and a quiet **`(why?)`** link.
- **Travel day** (contains a timezone-change anchor): the switch renders as an **inline anchor row** in the day's sequence: `✈ Switch to Hawaii Time (5 hours earlier)`, with `(why?)` on the row itself. Items above it show their prior-zone time, items below their new-zone time. The header carries a `TRAVEL DAY` pill with **no subtitle**.

**`(why?)`** reveals a terse one-line provenance plus correction actions — no explanation of mechanics (users infer it):
- inferred → `Inferred from "Flight to DEN" on Thursday`
- user → `Set by you on Jun 14`
- device → `From your device`
- Actions: **Use my current zone** / **Pick a different zone…**. Correcting an `inferred` anchor removes its whole `inference_group`; choosing a zone creates a superseding `user` anchor.

"Current zone" (for the subtext and corrections) = the zone in effect at *now* (the most recent anchor at-or-before the present, normally device-sourced).

### D6 — Onboarding (lightweight)

Onboarding seeds the **first timezone-change anchor** silently from the device zone — no mandatory "pick your timezone" step, honoring the lightweight-management constraint and the no-default-zone principle (the first anchor is a dated event, not a standing default).

### D7 — #920 cleanups (in this scope)

- **Date-only construction:** standardize the scattered `new Date('…T12:00:00Z')` / `'T12:00:00'` / `'T00:00:00'` / `new Date(y, m-1, d)` sites onto **one noon-anchored local helper**, fixing the risky midnight-local outliers (`day-header.ts`, `day-redirect.guard.ts`) first.
- **`scheduled_start` / `preferred_time`:** stop the UTC-wall-clock round-trip; treat as wall-clock resolved against D2. Remove `deserialize_opt_hhmm`'s UTC re-interpretation and the client UTC-strip in `week-plan.service.ts`.

### D8 — Instant resolution & DST policy

When a wall-clock value must become an absolute instant (notifications, "is it now"), resolve it in the zone determined by D2 using `chrono-tz`. For **ambiguous** (fall-back/overlap) or **nonexistent** (spring-forward/gap) local times, apply a single documented policy: prefer the **earlier** offset for ambiguous times and roll **forward** to the next valid instant for nonexistent times. This is a display-irrelevant edge (day-view ordering is positional) but must be deterministic for scheduling.

### D9 — Device-signal conservatism (anti-stale-clock)

A `device` reading is ground-truth for *now* only when reliable; right after arrival it may be stale (device clock not yet updated, or a laptop still set to the home zone). A naive "append on any difference" rule would let a bad reading silently overwrite a correct `user`/`inferred` switch. The device-affirm path is therefore conservative:

- **Match → no-op.** A device reading equal to the currently-effective zone is always silently ignored (the common case).
- **Difference with no conflicting recent assertion → append.** Normal self-heal: the user moved, the device noticed, a `device` anchor is appended.
- **Difference that contradicts a still-active higher-trust assertion → distrust.** While inside a round-trip **bracket** (between an `inferred`/`user` depart and return anchor), a contradicting device reading is *not* applied. For an **open-ended** assertion (no return anchor), a contradicting reading must **corroborate** — persist across sessions / a dwell period — before it can supersede; a single stale reading cannot flip the zone.
- **Genuine standoff → one-time gentle confirm.** When device and intended zone keep disagreeing past the corroboration threshold, surface a single quiet prompt (e.g. *"Back in Eastern time, or is your device clock off?"*). Resolving it creates the appropriate `user` anchor (or dismisses the standoff); it is not re-asked for the same standoff. This is the only prompt the timezone feature raises — everywhere else relies on silent auto-apply plus the `(why?)` control.

Exact bracket/corroboration thresholds are an implementation-plan detail.

## 3. Data model

A timezone-change anchor is persisted as an instance-level, schedule-scoped record (exact table/column shaping belongs to the implementation plan, not this spec):

- `user_id`
- `effective_position` — its place in the ordered anchor sequence: a date plus an ordering key relative to that date's other anchors (positional/time-optional, per D2 and §4.7/§4.8).
- `zone` — IANA name (validated against the `chrono-tz` set).
- `source` — `device` | `user` | `inferred`.
- `source_ref` — for `inferred`, the originating task/calendar item.
- `inference_group` — links the depart/return pair so a dismissal removes both.

Storage is reached **only** through a repository trait in `plnd_data` (per the storage-isolation rule in CLAUDE.md); no `sqlx`/`PgPool` in `plnd_api` or `plnd_agent`, and no public re-export of `sqlx` types.

## 4. Resolution components (isolation boundaries)

- **`zone_at(user, position) -> Tz`** — pure: the most recent timezone-change anchor at or before a position. The single source of truth for "what zone applies here." Testable in isolation against an in-memory anchor list.
- **`resolve_instant(wall_clock, Tz) -> DateTime<Utc>`** — pure: applies D8's DST policy. Used only at the notification/"now" edge.
- **Day-view zone projection** — given a materialized day's ordered anchors, assigns each item its display zone by walking the order. Consumes `zone_at`; owns no resolution logic itself.
- **Device-affirm path** — on app load, compares reported IANA zone to `zone_at(now)` and conditionally appends a `device` anchor. Owns the no-churn check and the D9 conservatism logic (bracket distrust, corroboration, standoff confirm).
- **Inference path (agent)** — owns the confidence bar and `inference_group` construction; emits anchors through the repository trait. Knows nothing about display.

## 5. architecture.md change list

(Per #920 and the user directive that updating the design reference is in scope; abstract design intent only — no code, file paths, or issue numbers, per the architecture-doc conventions.)

- **§4.3 Daily rhythm** — replace the "day-view UI labeling … is a presentation concern the data model does not constrain" hand-wave with a pointer to the new timezone model; state that wall-clock values are resolved against it.
- **§4.7 Anchors** — add the **timezone-change anchor** as a fourth anchor source; note it is positional/time-optional and that it establishes the zone for subsequent anchors.
- **New subsection (under §4)** — *Time and timezone resolution*: the wall-clock + resolved-zone model, the "most recent timezone-change anchor at or before a point" rule, the three signal sources, no-default-zone principle, and the instant/DST policy at the edge.

## 6. Technical footprint

- Add `chrono-tz` to `plnd_data`, `plnd_api`, `plnd_agent`.
- New repository trait + methods in `plnd_data` for timezone-change anchors.
- Client: device-zone detection + report on load; day-view chip/subtext/`(why?)`; inline travel-day anchor row; the single noon-anchored date helper (D7).
- Agent: confidence-gated inference emitting timezone-change anchors.

## 7. Testing

- **Unit (Rust):** `zone_at` ordering/precedence, `resolve_instant` DST ambiguous/nonexistent policy, no-default-zone before onboarding, D9 device conservatism (match no-op, normal self-heal, in-bracket distrust, open-ended corroboration, standoff confirm).
- **Unit (Angular):** the date-only helper; day-view zone projection (full divergent day vs travel day); chip/subtext/`(why?)` rendering.
- **Rust integration (fixture-backed):** agent inference creates the correct anchor pair from a travel task at/above the confidence bar and nothing below it (per the e2e mock policy — agent logic is exercised in Rust, not the browser).
- **e2e:** a seeded future-trip user sees the travel-day inline anchor and a downstream full day in the destination zone; `(why?)` correction reverts to the current zone. Seed via real API helpers, not `/test/seed`.

## 8. Out of scope / follow-ups

- **Calendar-item travel inference** depends on the future calendar-integration feature; D4 is written to accept it as another `source_ref` origin when it lands.
- **Multi-leg single-day itineraries** (two switches in one day) are supported by the model (multiple timezone-change anchors per day) but the day-view treatment beyond a single inline switch row should be validated separately if it proves common.
