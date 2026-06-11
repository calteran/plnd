# Onboarding first planning window — design

**Date:** 2026-06-11
**Status:** Approved for implementation
**Related:** [Onboarding enrichment design](./2026-04-22-onboarding-enrichment-design.md) (supersedes its first-window derivation, §"Plan-period computation"), architecture.md §4.9

## Problem

The onboarding wizard's first planning window is wrong in two ways:

1. **It ignores the user's week boundary.** `computeFirstPlanPeriod` plans a rolling
   `default_plan_length_days`-long window starting from *today*, regardless of where today
   falls in the user's week. Onboarding on a Wednesday with a Monday-start week produces
   `Wed → next Tue` instead of `Wed → Sun` (the rest of the current week).

2. **The "roll into the following week" branch is dead.** The function was specified
   (onboarding-enrichment design, lines 173–177) to extend the window to the following
   week when the user is most of the way through the current week — gated by
   `days_until_trigger / default_plan_length_days < 0.15`. But the function never receives
   `week_start_day`, so it computes `days_until_trigger` as `default_plan_length_days + offset`,
   a near-constant that never drops below the 0.15 threshold under real preference values.
   The branch exists but cannot fire.

The root cause of both is the same omission: the window is anchored on *today* rather than on
the user's configured `week_start_day`. The original spec called for `first_trigger_date` to be
"derived from `week_start_day`, `default_plan_length_days`, and `planning_trigger_offset`," but
the implementation never plumbed `week_start_day` through.

## Desired behavior

The first plan should start **the day after onboarding** and run **to the end of the user's
current week**, extending **into the following week** when little of the current week remains.

- **`plan_start = tomorrow`** (today + 1). A brand-new user should not be asked to plan a day
  that has already started; the first plannable day is the day after they finish onboarding.
- **Normal case:** `plan_end` is the inclusive last day of the week that contains `plan_start`,
  where a "week" is `default_plan_length_days` long and anchored on `week_start_day`.
- **Roll-over case:** when the next weekly-planning prompt is imminent — `days_until_trigger`
  is less than 15% of a plan length away — `plan_end` extends to the end of the *following*
  week, so the first plan is substantive rather than a one- or two-day stub.

This is a behavior change from the onboarding-enrichment spec, which set the normal-case
`plan_end` to `today + default_plan_length_days` (a rolling window). The week-aligned end and
the `plan_start = tomorrow` start both supersede that earlier intent.

## Algorithm

`computeFirstPlanPeriod` gains a `week_start_day` parameter and computes everything relative to
`plan_start` (tomorrow):

```
plan_start          = today + 1
anchorDow           = plan_start's day-of-week (0=Sun … 6=Sat)
daysSinceWeekStart  = (anchorDow − week_start_day + 7) % 7
currentPeriodStart  = plan_start − daysSinceWeekStart     // most recent week-start ≤ plan_start
nextPeriodStart     = currentPeriodStart + planLength
currentPeriodEnd    = nextPeriodStart − 1                 // inclusive end of plan_start's week

first_trigger_date  = nextPeriodStart + offset            // next weekly-planning prompt date
days_until_trigger  = first_trigger_date − plan_start

plan_end = (days_until_trigger / planLength < 0.15)
             ? nextPeriodStart + planLength − 1           // roll into following week
             : currentPeriodEnd                            // end of current week

// Guard retained from the existing implementation: plan_end is never earlier than
// currentPeriodEnd (protects against large negative offsets, |offset| > planLength).
return { start: plan_start, end: plan_end }
```

Where `planLength = default_plan_length_days` and `offset = planning_trigger_offset`.

### Why anchor on `plan_start` rather than `today`

Anchoring the week computation on `plan_start` (tomorrow) keeps the "onboard on the last day of
the week" case correct: if today is the final day of the current week, `plan_start` is already
the first day of the next week, and the normal branch plans a clean full following week. The
0.15 roll-over branch still fires for the genuinely-at-the-end cases (e.g. onboarding the second
to last day, where `plan_start` lands on the last day and `days_until_trigger` collapses to 0).

### `planLength ≠ 7`

`week_start_day` is a day-of-week (a 7-day cycle), while `default_plan_length_days` may be 1–14.
For non-7 lengths the period start is still anchored on the most recent `week_start_day` (mod 7)
on or before `plan_start`, and the period runs `planLength` days from there. This mirrors the
steady-state planning window's assumption (a `planLength`-day window beginning on a week-start
day) and keeps onboarding consistent with the recurring planning surface. The default and common
case is `planLength = 7`, where period and calendar week coincide.

## Worked examples

Week starts Monday, `planLength = 7`, `offset = −1`:

| Onboard (today) | plan_start | plan_end | span | branch |
|---|---|---|---|---|
| Wednesday | Thursday | Sunday | 4 days | normal |
| Monday | Tuesday | Sunday | 6 days | normal |
| Sunday | Monday (next wk) | Sunday (next wk) | 7 days | normal |
| Saturday | Sunday | next Sunday | 8 days | roll-over (`days_until_trigger = 0`) |

## Scope

The meal and task onboarding spokes already share a single `planPeriod`, set by
`computeFirstPlanPeriod` via `computeAndSetPlanPeriod` and consumed by both the meal-plan and
place-tasks agent calls. Fixing the one function corrects both surfaces; there is no separate
task-side window logic to change.

1. **`computeFirstPlanPeriod`** — add `week_start_day` to the signature, derive
   `plan_start = today + 1`, week-align the window, and revive the 0.15 roll-over branch. The
   two call sites continue to pass `today`; "tomorrow" is derived inside the function.
2. **Unit tests** — rewrite the `computeFirstPlanPeriod` and `computeAndSetPlanPeriod` cases to
   cover tomorrow-start, week-alignment, the normal and roll-over branches, the `planLength ≠ 7`
   case, and the large-negative-offset clamp.
3. **Architecture doc §4.9** — add one abstract paragraph describing first-window derivation:
   the first window begins the day after onboarding, spans to the end of the user's current
   week, and extends into the following week when little of the current week remains. No code,
   file paths, or process references, per the doc's conventions.
4. **No backend changes** — the meal-plan and place-tasks endpoints already accept `plan_start`
   and `plan_end`.

## Testing

- Unit: `computeFirstPlanPeriod` cases above, run from the worktree's `plnd_client`.
- Full gate: `just verify` (includes Angular unit + e2e). Watch for any e2e that hardcodes
  onboarding plan dates; update expectations to the tomorrow-start, week-aligned window if so.

## Out of scope

- The steady-state planning wizard / sidebar status window (`main-layout`): it already plans the
  next full week ahead and is future-dated by construction, so `plan_start = tomorrow` does not
  apply. Left unchanged.
