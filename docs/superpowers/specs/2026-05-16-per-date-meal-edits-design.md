# Per-date meal anchor edits — design

**Issue:** [#820](https://github.com/calteran/plnd/issues/820)
**UI follow-up:** [#826](https://github.com/calteran/plnd/issues/826)
**Predecessor:** [#74](https://github.com/calteran/plnd/issues/74) (closed in favor of #820)
**Status:** Design — accompanies the architecture-doc rewrite in the same PR. Implementation tracked separately.

## Context

`docs/architecture.md` §4.3 and §4.6 used to describe day-type meal lists as the runtime source of truth for a date's meal anchors, and explicitly asserted "no override layer." That model handles *recurring* variance (Weekday vs. Weekend vs. Travel day-types) but cannot represent *one-off* variance — a midweek snack the user happened to want, a second lunch on an unusually long travel day, a skipped lunch on a fasting day, a late dessert after a party. Creating a new day-type for each one-off is heavy and restructures the user's rhythm config.

The doc had also accumulated an internal contradiction: §4.6 asserted "no override layer" in two places, but the same section described a "per-date override" that pinned a meal to a fixed clock time for a single date. This design resolves the contradiction *and* generalizes the per-date capability.

## Design summary

| Question | Decision |
|---|---|
| Conceptual model | **Template + Instance** (mirrors the routine → task analog in §4.5) |
| User operation set | **add / remove / rename / retime** — four operations on a date's instances |
| Materialization trigger | Lazy: first need — planning agent run OR user edit |
| Edit window | Past + future + far-future (far-future edit triggers materialization for that date) |
| Cascade on remove | Cascade-delete the planned meal content attached to the instance |
| Template change after materialization | Does **not** propagate to already-materialized dates |
| Anchor-presence axis (§4.6) | Becomes per-date (was per-day-type) |
| `advance_meal_planning_enabled` | Unchanged semantics; conjunction rule applies per-date |
| Out of scope | SQL schema, table/column names, UI gesture, promotion-to-template suggestion, bulk operations |

## Conceptual model

The day type's meal list becomes a **template** — an ordered list of meal entries (name, `preferred_time`, `tolerance_minutes`, `sort_order`) describing the meals that typically occur on dates of that day type. The template is not the runtime source of truth for any specific date; it is a generator.

Each date carries its own **meal anchor instances** — concrete per-date anchors that derive from the active day type's template at materialization. Once materialized, the date's instances are independent records: they reference the template only by lineage, not by live read. Subsequent edits to the template do not propagate into a date that has already materialized; subsequent edits to a date's instances do not propagate back into the template.

This shape is the same one already used for routines and tasks in §4.5: a routine is a generator; tasks are concrete per-date instances; once instantiated, tasks are independent of their routine. The conceptual continuity means a reader who has internalized the routine→task model already understands the meal template→instance model.

Materialization is **lazy on first need**: a date's instances come into existence at the first moment they are needed. Two triggers:

- **The planning agent runs for the date.** Before slot resolution, the agent materializes instances for any in-window date that has not yet been materialized.
- **The user edits the date's anchors.** Editing a far-future date that has not yet been materialized triggers materialization for that date as part of the edit. The user's edit is then applied to the freshly-materialized instances.

The lazy-on-first-need rule keeps the model uniform: every read of a date's meal anchors reads from the instance layer, regardless of whether the user has touched the date. There is no "pattern read with overrides applied at request time" code path.

## Behavioral semantics

The user can perform four operations on a date's meal anchor instances:

- **Add.** A new meal anchor at a specified `preferred_time` (with an optional `tolerance_minutes`). The new instance enters the date's list and participates in the date's sequence by `preferred_time` order. If `advance_meal_planning_enabled` is `true`, the next planning pass (catch-up or "fill open slots") fills the new anchor with a dish; if `false`, the anchor is a structural rhythm marker only.
- **Remove.** The instance is deleted along with any planned meal content attached to it. The cascade-delete is intentional: from the user's perspective they are removing a meal for the date, and they should not be left to clean up a dangling dish. No tombstone is retained — if the user undoes by re-adding, that's a fresh add operation.
- **Rename.** The instance's name changes on a single date (Breakfast → Brunch for Sunday). The template is untouched. Any attached planned meal stays attached.
- **Retime.** The instance's `preferred_time` (and optionally `tolerance_minutes`) changes on a single date. The template is untouched. Any attached planned meal stays attached. This subsumes the older capability of "pinning a meal to a specific clock time on a specific date" — the pre-existing §4.6 paragraph describing that capability is removed and absorbed here.

**Past dates remain editable for record-keeping.** Adjusting yesterday's lunch to record that it actually happened at 13:30 instead of 12:30, or adding a late-night snack that was eaten but not planned, is allowed. Past-date edits update the historical record but do not trigger any agent runs.

**Template changes do not propagate to materialized dates.** A user who renames "Lunch" to "Midday Meal" in their Weekday day type sees the new name only on dates that have not yet materialized. Already-materialized dates keep their existing instance names. This matches the routine→task analog and avoids surprising the user with retroactive rewrites of past or in-flight plans.

**Anchor presence is now a property of the date.** §4.6's anchor-presence axis evaluates the date's materialized instances rather than the active day type's template. Two dates that resolve to the same day type may have different anchor-presence values if the user has emptied one of them. The conjunction rule with `advance_meal_planning_enabled` is preserved and applies per-date: dish planning runs for a date only when that date has at least one anchor instance *and* the flag is `true`.

## Planning pipeline interaction

The slot-resolution chokepoint today reads the day-type meal template to determine what slots exist for a date. Under the new model, slot resolution reads the date's materialized instances instead. The chain becomes:

1. **Materialize on first need.** When the planning agent runs for a date with no existing instances, materialize from the active day type's template. When the user edits a date with no existing instances, materialize as part of the edit.
2. **Resolve open slots.** "Slots needing a dish" is the list of instances for the date that have no planned meal attached. The template-to-instance step happens only at materialization; runtime reads have no merge step.
3. **Catch-up.** Walks the date window, materializes any not-yet-materialized in-window dates, fills open instances. Already-materialized instances are respected — the user's edits remain in place.
4. **Re-plan.** Preserves all instance edits as constraints. Anchors that exist are the anchors that exist; the agent fills only ones with no planned meal.

The per-slot nutrition aggregation that landed in PR #819 already joins planned-meal rows against schedule-anchor rows; this design preserves that join shape. Added instances appear in the aggregation as soon as they are filled; removed instances are simply absent. No changes required to aggregation logic.

The `advance_meal_planning_enabled` flag retains its existing semantics — it determines whether the LLM proposes specific dishes vs. using anchors purely as structural rhythm. Per-date instance edits act on the anchor layer regardless of the flag's value; the conjunction with the per-date anchor-presence axis governs whether dish planning runs for the date.

## Architecture doc changes (companion edits)

The same PR amends `docs/architecture.md`. The changes:

- **§4.3 (Daily rhythm).** The "Meals" bullet under "Each day type carries" reframes the meal list as a template that generates per-date instances at materialization. The paragraph beginning "A user expresses 'weekend brunch later than weekday breakfast'…" loses its trailing "no override layer" clause and gains a reference to the per-date instance layer. Two relationship bullets ("Anchors (§4.7)" and "Meals (§4.6)") are reworded to mention the instance layer.
- **§4.6 (Meals).** The opening paragraph's "no global meal pattern... no override layer" clause is replaced with template-and-instance language. The Anchor presence axis bullet is rewritten to evaluate the date's materialized instances rather than the active day type's list. The four-corner state table is preserved but its preamble and header column are updated to evaluate per-date. The "Time positioning" bullet loses its "no override layer" sentence and gains language about template values inheriting into instances. The old "Per-date override" bullet (time-pinning only) is deleted; a new subsection `Per-date meal anchor instances` describes materialization, the four operations, the cascade-on-remove rule, the past-date record-keeping behavior, and the interaction with the conjunction rule.
- **Glossary.** *Meal* entry lightly reframed to mention template/instance. *Meal anchor* entry appended to clarify each date's anchors are materialized instances. *Meal pattern* (deprecated) entry's trailing clause updated to reference the new template+instance model. Two new entries added: *Meal anchor template* and *Meal anchor instance*.
- **Changelog.** New entry `1.10` describing the structural change.

The architecture doc edits contain no implementation references — no file paths, no table names, no issue numbers — per the project rule that the architecture doc states design intent only.

## Scope and follow-ups

**In scope for this PR (issue #820):**

- The §4.3 / §4.6 / glossary rewrites described above.
- This design spec.
- The UI follow-up issue (#826) — filed before this PR merges and referenced from the spec header.

**Out of scope (deferred to a separate implementation issue):**

- SQL schema, table names, column types, migration files, repository methods, and API endpoints. These belong in the implementation PR. The spec deliberately names artifacts conceptually ("meal anchor template," "meal anchor instance") without committing to storage shapes.
- The UI gesture or widget — owned by #826.
- A "promote a recurring per-date edit into the day-type template" suggestion feature.
- Bulk operations across multiple dates ("apply this edit to every Tuesday").
- Changes to `advance_meal_planning_enabled` semantics — the flag stays as documented; this design only clarifies that anchor-presence is now per-date.

## Migration plan (conceptual)

This change does not require a data backfill. Un-materialized dates continue to resolve from the active day type's template on first need; the lazy-materialization rule is what new code introduces, and existing code paths that read the template directly are gradually replaced.

The existing meal pattern storage becomes the **template** store. The instance store is a new concern of the implementation PR; the implementation issue will choose its shape (a separate table, an extension of an existing structure, or something else) and own the migration.

## Test-surface change note

The existing `resolve_open_slots_*` tests in the data layer today verify pattern → slot derivation. Under the new model, those tests will shift to verifying two separate steps:

- **Template → instance materialization** for a date.
- **Instance → open-slot resolution** for that date.

This is a meaningful but bounded test-surface change. The implementation PR will own the test rewrites; it is not a blocker for this design.

## Verification

This design is verified by:

- The architecture doc edits read coherently in context. No "override layer" references remain anywhere in the doc. The §4.3 ↔ §4.6 cross-references are consistent. The four-corner state table reads correctly with the per-date framing.
- The UI follow-up issue (#826) is open and references this spec.
- The deprecated *Meal pattern* glossary entry still resolves the question a reader asks when they encounter the term in older history.
