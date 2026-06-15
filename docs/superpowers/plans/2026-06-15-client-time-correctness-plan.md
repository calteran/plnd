# Client Time Correctness (Part A of #931) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the #920 time-correctness defects — consolidate the scattered date-only `Date` construction conventions onto one noon-anchored *local* helper, and stop the UTC wall-clock round-trip so a non-UTC user's planned times persist and display unchanged.

**Architecture:** This is **Part A** of sub-issue #931 (master timezone effort #928), carved out as its own PR. It is the self-contained, independently-testable time-correctness slice (design decision **D7**). Parts B/C/D (device report, onboarding seed, day-view surfacing) follow in a second PR. The round-trip fix is **contained** (per the user decision): the wire contract for planned wall-clock times becomes a plain `HH:MM` string and the client stops parsing them through `Date`; storage stays `timestamptz` as an internal encoding. The full storage migration (`timestamptz → time`) and D8 instant-resolution are deferred to **#936**.

**Tech Stack:** Angular 21 (standalone components, signals) + Rust/Axum (`plnd_api`, `plnd_data`). Client tests: `npx ng test` run from this worktree's `plnd_client/`. Backend tests: `just verify` (which runs nextest + clippy + e2e).

---

## Background: the round-trip, precisely

`schedule_entries.scheduled_start` / `scheduled_end` are `timestamptz`. A planned wall-clock time like `09:00` is stored by combining it with the entry's date **at UTC** (`plnd_data/src/db/schedule.rs:251` → `entry.date.and_time(t).and_utc()`), producing `2026-06-15T09:00:00Z`. On read it is serialized as an ISO instant and the client strips the **UTC** `HH:MM` back out (`schedule.service.ts:271` `hhmmUtc`, `week-plan.service.ts:441` `utcHHMM`). The value only survives because every layer agrees on UTC — the "pretending wall-clock is UTC" that D1 wants gone.

**What changes (contained fix):**
- **Wire (read path) only:** `ScheduleEntryResponse.scheduled_start`/`scheduled_end` and `TaskResponse.scheduled_start` serialize as `Option<String>` holding `"HH:MM"`, extracted from the stored UTC time-of-day.
- **Client:** delete `hhmmUtc` / `utcHHMM`; use the `HH:MM` string directly.

**What deliberately does NOT change:**
- The **write path** (`entry.date.and_time(t).and_utc()`) and the `timestamptz` columns stay — now an internal encoding (tracked for full migration in #936).
- `deserialize_opt_hhmm` (`plnd_api/src/models.rs:32`) stays: it already yields a wall-clock `NaiveTime` (no UTC reinterpretation lives there; the issue's phrasing is imprecise).
- `preferred_time` stays: it is already a `TIME` column returned as `"HH:MM:SS"` (no round-trip).
- `actual_start` / `actual_end` stay `Option<DateTime<Utc>>`: they are genuine recorded instants, not planned wall-clock.

---

## File Structure

- **Create:** `plnd_client/src/app/core/utils/date-only.ts` — the single noon-anchored local date helper.
- **Create:** `plnd_client/src/app/core/utils/date-only.spec.ts` — unit tests (DST / negative-offset / no day-shift).
- **Modify (adopt helper):**
  - `plnd_client/src/app/core/utils/day-type-utils.ts` (noon-UTC → helper)
  - `plnd_client/src/app/features/planning/utils/date-format.utils.ts` (noon-local → helper)
  - `plnd_client/src/app/core/services/week-plan.service.ts` (`horizonDays` noon-local → helper)
  - `plnd_client/src/app/features/schedule/components/day-header/day-header.ts` (**midnight-local outlier `T00:00:00`** → helper)
  - `plnd_client/src/app/core/guards/day-redirect.guard.ts` (**midnight-local outlier `new Date(y,m-1,d)`** → helper)
- **Modify (round-trip, backend):** `plnd_api/src/api_response.rs` (two DTOs + `From` impls).
- **Modify (round-trip, client):** `plnd_client/src/app/core/services/schedule.service.ts` (drop `hhmmUtc`), `plnd_client/src/app/core/services/week-plan.service.ts` (drop `utcHHMM`), `plnd_client/src/app/core/models/schedule.ts` + `week-plan.ts` (comment cleanup).
- **Docs:** none required beyond this plan (architecture.md §4 already updated in #930; no new abstract design intent here).

---

## Task A1: Single noon-anchored local date helper

**Files:**
- Create: `plnd_client/src/app/core/utils/date-only.ts`
- Test: `plnd_client/src/app/core/utils/date-only.spec.ts`

**Why noon-local:** parsing `YYYY-MM-DD` at **local noon** (`new Date(y, m-1, d, 12)`) means every subsequent local-component read (`getDay`, `getFullYear`, locale formatting) and noon-to-noon difference (`/86_400_000` rounded; DST makes a step 23/24/25h, which rounds correctly) lands on the intended calendar day regardless of timezone offset or DST. Midnight-local (`T00:00:00`) and bare-UTC (`T12:00:00Z` read with local getters) are the buggy conventions this replaces.

- [ ] **Step 1: Write the failing tests**

```ts
// plnd_client/src/app/core/utils/date-only.spec.ts
import { parseDateOnly, toDateOnly, addDaysDateOnly, daysBetweenDateOnly, dayOfWeekBit } from './date-only';

describe('date-only helper', () => {
  it('parseDateOnly yields the same calendar day in local time', () => {
    const d = parseDateOnly('2026-03-08'); // US spring-forward date
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);   // March (0-based)
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(12);  // anchored at local noon
  });

  it('toDateOnly round-trips a parsed date-only string', () => {
    expect(toDateOnly(parseDateOnly('2026-03-08'))).toBe('2026-03-08');
  });

  it('addDaysDateOnly does not shift across a DST boundary', () => {
    // 2026-03-08 is US spring-forward; +1 day must be the 9th, not the 8th/10th.
    expect(addDaysDateOnly('2026-03-08', 1)).toBe('2026-03-09');
    // 2026-11-01 is US fall-back; -1 day must be Oct 31.
    expect(addDaysDateOnly('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('daysBetweenDateOnly counts whole days across DST', () => {
    expect(daysBetweenDateOnly('2026-03-09', '2026-03-08')).toBe(1);
    expect(daysBetweenDateOnly('2026-11-02', '2026-10-31')).toBe(2);
    expect(daysBetweenDateOnly('2026-03-08', '2026-03-08')).toBe(0);
  });

  it('dayOfWeekBit returns the correct weekday bit', () => {
    // 2026-06-15 is a Monday → getDay() === 1 → 1 << 1 === 2
    expect(dayOfWeekBit('2026-06-15')).toBe(1 << 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `plnd_client/`): `npx ng test --include='**/date-only.spec.ts' --watch=false`
Expected: FAIL — module `./date-only` not found.

- [ ] **Step 3: Implement the helper**

```ts
// plnd_client/src/app/core/utils/date-only.ts
// The single date-only helper. Parses YYYY-MM-DD at LOCAL NOON so calendar
// arithmetic and locale formatting never cross a day boundary under any
// timezone offset or DST transition (noon ± 1h DST drift stays within the day).
// Replaces the scattered 'T12:00:00Z' / 'T12:00:00' / 'T00:00:00' /
// new Date(y, m-1, d) conventions (see #920 / design decision D7).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a `YYYY-MM-DD` date-only string as a Date at local noon. */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Format a Date back to `YYYY-MM-DD` using its local calendar components. */
export function toDateOnly(d: Date): string {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Add `n` days (may be negative) to a date-only string, returning a date-only string. */
export function addDaysDateOnly(iso: string, n: number): string {
  const d = parseDateOnly(iso);
  d.setDate(d.getDate() + n);
  return toDateOnly(d);
}

/** Whole-day count `later - earlier` between two date-only strings. */
export function daysBetweenDateOnly(later: string, earlier: string): number {
  const ms = parseDateOnly(later).getTime() - parseDateOnly(earlier).getTime();
  return Math.round(ms / MS_PER_DAY);
}

/** Day-of-week bit (0=Sun…6=Sat → `1 << dow`) for a date-only string. */
export function dayOfWeekBit(iso: string): number {
  return 1 << parseDateOnly(iso).getDay();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `plnd_client/`): `npx ng test --include='**/date-only.spec.ts' --watch=false`
Expected: PASS (5 specs).

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/core/utils/date-only.ts plnd_client/src/app/core/utils/date-only.spec.ts
git commit -m "feat(client): add single noon-anchored date-only helper (#931)"
```

---

## Task A2: Adopt the helper at the five cited sites

**Files:**
- Modify: `plnd_client/src/app/core/utils/day-type-utils.ts`
- Modify: `plnd_client/src/app/features/planning/utils/date-format.utils.ts`
- Modify: `plnd_client/src/app/core/services/week-plan.service.ts:350-366` (`horizonDays`)
- Modify: `plnd_client/src/app/features/schedule/components/day-header/day-header.ts` (outlier)
- Modify: `plnd_client/src/app/core/guards/day-redirect.guard.ts` (outlier)

**Context:** Fix the two **midnight-local outliers** (`day-header.ts` `T00:00:00`, `day-redirect.guard.ts` `new Date(y,m-1,d)`) — these can land on the wrong calendar day under a negative UTC offset — then converge the noon-UTC and noon-local sites onto the shared helper for DRY. `schedule.service.ts`'s `localIsoDate`/`todayIso`/`offsetIso` are already local-safe and widely imported; leave them (out of this cleanup's risk scope).

- [ ] **Step 1: day-type-utils.ts — replace local `dayOfWeekBit`/`daysBetween` with the helper**

Replace the two private functions (lines 4-15) with imports. New top of file:

```ts
import { DayTypeResponse } from '../models/day-type';
import { MealPatternEntry } from '../models/meal-pattern';
import { dayOfWeekBit, daysBetweenDateOnly } from './date-only';
```

Delete the local `dayOfWeekBit` and `daysBetween` functions. In `cycleMatchesDate`, replace `daysBetween(date, dt.anchor_date)` with `daysBetweenDateOnly(date, dt.anchor_date)`. `activeDayTypeForDate` keeps calling `dayOfWeekBit(date)` (now the imported one).

- [ ] **Step 2: date-format.utils.ts — replace `noonDate` and `daysInRange` with the helper**

```ts
// plnd_client/src/app/features/planning/utils/date-format.utils.ts
// Shared date-formatting helpers for planning wizard step components.
// All parsing goes through the noon-anchored local date-only helper.
import { parseDateOnly, addDaysDateOnly } from '../../../core/utils/date-only';

/** "Mon, Jan 6" */
export function formatDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** "Jan 6" */
export function formatDayDate(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Mon" */
export function formatDayName(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString('en-US', { weekday: 'short' });
}

export const formatWeekDate = formatDayDate;

/** ISO date strings from start to end inclusive. */
export function daysInRange(start: string, end: string): string[] {
  if (!start || !end) return [];
  const days: string[] = [];
  for (let cur = start; cur <= end; cur = addDaysDateOnly(cur, 1)) days.push(cur);
  return days;
}
```

- [ ] **Step 3: week-plan.service.ts — `horizonDays` uses `daysInRange`/helper**

Replace the `horizonDays` computed body (lines 350-366) so it delegates to the helper. Add import at top: `import { addDaysDateOnly } from '../utils/date-only';`. New body:

```ts
  readonly horizonDays = computed(() => {
    const start = this.planStartSignal();
    const end   = this.planEndSignal();
    if (!start || !end) return [];
    const days: string[] = [];
    for (let cur = start; cur <= end; cur = addDaysDateOnly(cur, 1)) days.push(cur);
    return days;
  });
```

(Leave `utcHHMM` for Task A3.)

- [ ] **Step 4: day-header.ts — fix the `T00:00:00` outlier**

In `formattedDate` (line 26-27) replace `new Date(this.date() + 'T00:00:00')` with `parseDateOnly(this.date())`. In `offset` (line 44-48) replace the `Date.UTC` arithmetic with the helper. Add import `import { parseDateOnly, addDaysDateOnly } from '../../../../core/utils/date-only';`. New bodies:

```ts
  readonly formattedDate = computed(() => {
    return parseDateOnly(this.date()).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
  });

  // ...

  private offset(days: number): string {
    return addDaysDateOnly(this.date(), days);
  }
```

Remove the now-unused `toIsoDate` import (keep `todayIso`).

- [ ] **Step 5: day-redirect.guard.ts — fix the `new Date(y,m-1,d)` outlier in `isValidIsoDate`**

`isValidIsoDate` (lines 14-19) uses `new Date(y, m-1, d)` (midnight-local) to validate roundtrip. Anchor at noon via the helper to keep the validation offset-proof:

```ts
import { parseDateOnly } from '../utils/date-only';

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = parseDateOnly(s);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
```

- [ ] **Step 6: Run the affected unit suites**

Run (from `plnd_client/`):
`npx ng test --include='**/day-type-utils.spec.ts' --include='**/date-format.utils.spec.ts' --include='**/day-header.spec.ts' --include='**/day-redirect.guard.spec.ts' --watch=false`
Expected: PASS. If any spec asserted the old midnight-local behavior, update it to expect the corrected (noon-anchored) calendar day. If a cited spec file does not exist, note it; do not create new suites here (helper coverage lives in A1).

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/core/utils/day-type-utils.ts \
        plnd_client/src/app/features/planning/utils/date-format.utils.ts \
        plnd_client/src/app/core/services/week-plan.service.ts \
        plnd_client/src/app/features/schedule/components/day-header/day-header.ts \
        plnd_client/src/app/core/guards/day-redirect.guard.ts
git commit -m "refactor(client): converge date-only parsing onto the noon-anchored helper (#931)"
```

---

## Task A3: Stop the UTC wall-clock round-trip (backend wire + client, atomic)

**Files:**
- Modify: `plnd_api/src/api_response.rs` (`TaskResponse` ~403-433, `ScheduleEntryResponse` ~440-485)
- Modify: `plnd_client/src/app/core/services/schedule.service.ts` (drop `hhmmUtc`, line 262 + 271-274)
- Modify: `plnd_client/src/app/core/services/week-plan.service.ts` (drop `utcHHMM`, line 129 + 441-443)
- Modify: `plnd_client/src/app/core/models/schedule.ts:12` and `week-plan.ts:122` (comment cleanup)

**Why atomic:** the wire contract and client consumption must change in the same commit — emitting `HH:MM` while the client still ran `new Date("09:00")` (in `hhmmUtc`) would yield `Invalid Date` and break the e2e. Keep every commit green.

- [ ] **Step 1: Backend — write the failing Rust test for the `From` impl**

Add to `plnd_api/src/api_response.rs` test module (find the existing `#[cfg(test)] mod tests`; if `scheduled_start: None` appears at ~862 it confirms the module exists):

```rust
#[test]
fn schedule_entry_response_emits_wall_clock_hhmm() {
    use chrono::{TimeZone, Utc, NaiveDate};
    let mut e = sample_schedule_entry(); // existing helper used by the None case at ~862
    e.scheduled_start = Some(Utc.with_ymd_and_hms(2026, 6, 15, 9, 0, 0).unwrap());
    e.date = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
    let resp = ScheduleEntryResponse::from(e);
    assert_eq!(resp.scheduled_start.as_deref(), Some("09:00"));
}
```

If no reusable sample constructor exists, build a `ScheduleEntry` literal inline (mirror the field list at `plnd_data/src/models/schedule.rs:34-54`, `actual_*`/`scheduled_end` = `None`).

- [ ] **Step 2: Run it to verify it fails**

Run: `just verify` is heavy; for the fast loop use `cargo test -p plnd_api schedule_entry_response_emits_wall_clock_hhmm`.
Expected: FAIL — `scheduled_start` is still `Option<DateTime<Utc>>` (type error / mismatch).

- [ ] **Step 3: Backend — change the two DTOs to emit `HH:MM`**

In `TaskResponse`: change `pub scheduled_start: Option<DateTime<Utc>>,` → `pub scheduled_start: Option<String>,`. In its `From<Task>`: `scheduled_start: t.scheduled_start.map(|dt| dt.format("%H:%M").to_string()),`.

In `ScheduleEntryResponse`: change `scheduled_start` and `scheduled_end` to `Option<String>`. In its `From<ScheduleEntry>`:
```rust
scheduled_start: e.scheduled_start.map(|dt| dt.format("%H:%M").to_string()),
scheduled_end:   e.scheduled_end.map(|dt| dt.format("%H:%M").to_string()),
```
Leave `actual_start` / `actual_end` as `Option<DateTime<Utc>>`. Add a `///` doc note on each changed field: "Wall-clock `HH:MM` (the planned time-of-day); see #936 for the storage migration." `DateTime`/`Utc` imports may now be unused for these but remain used by `actual_*`/`created_at` — leave the import.

- [ ] **Step 4: Client — consume the `HH:MM` string directly**

`schedule.service.ts`: at line 262 change `scheduledStart: e.scheduled_start ? hhmmUtc(e.scheduled_start) : undefined,` → `scheduledStart: e.scheduled_start ?? undefined,`. Delete the `hhmmUtc` function (271-274). (`mapEntry`'s `floating` check at 256 already uses `e.scheduled_start` truthiness — unchanged.)

`week-plan.service.ts`: at line 129 change `scheduled_start: entry.scheduled_start ? utcHHMM(entry.scheduled_start) : undefined,` → `scheduled_start: entry.scheduled_start ?? undefined,`. Delete the `utcHHMM` function (441-443).

`schedule.ts:12`: change the comment `editable "HH:MM" (UTC wall-clock)` → `editable "HH:MM" (wall-clock)`. `week-plan.ts:122`: the `scheduled_start?: string | null` comment, if any UTC mention, drop "UTC".

- [ ] **Step 5: Client — update/extend specs**

If `schedule.service.spec.ts` seeds `scheduled_start` as an ISO instant (e.g. `'2026-06-15T09:00:00Z'`) and asserts `scheduledStart === '09:00'`, change the seed to the wall-clock string `'09:00'` and keep the assertion. Add one spec asserting `mapEntry` passes an `HH:MM` string through unchanged. Run (from `plnd_client/`): `npx ng test --include='**/schedule.service.spec.ts' --include='**/week-plan.service.spec.ts' --watch=false`. Expected: PASS.

- [ ] **Step 6: Full verification**

Run `just fmt` then `just verify`. The e2e acceptance for this slice — *a non-UTC user's entered time persists and displays unchanged* — is exercised by the existing schedule e2e under any runner TZ now that no `Date` parsing touches these values. Expected: all green. If e2e was previously passing only by UTC coincidence, it should still pass (wall-clock now flows through verbatim).

- [ ] **Step 7: Commit**

```bash
git add plnd_api/src/api_response.rs \
        plnd_client/src/app/core/services/schedule.service.ts \
        plnd_client/src/app/core/services/week-plan.service.ts \
        plnd_client/src/app/core/models/schedule.ts \
        plnd_client/src/app/core/models/week-plan.ts
git commit -m "fix(timezone): serve planned times as wall-clock HH:MM, drop client UTC strip (#931)"
```

---

## Self-Review

- **Spec coverage (D7):** date-only consolidation — A1+A2 (outliers fixed first). Round-trip removal — A3. The two D7 bullets in `docs/superpowers/specs/2026-06-15-timezone-handling-design.md` §D7 are both covered. ✓
- **Scope:** Part A only; B/C/D explicitly out (separate PR). Full storage migration deferred and tracked in **#936**. ✓
- **Type consistency:** helper exports (`parseDateOnly`/`toDateOnly`/`addDaysDateOnly`/`daysBetweenDateOnly`/`dayOfWeekBit`) are referenced by the same names in A2. Wire field becomes `Option<String>` on both DTOs; client DTO already typed `string`. ✓
- **Atomicity:** A3 changes wire + client together so each commit stays green. ✓
- **Placeholder scan:** none — every step has concrete code or an exact command. ✓
