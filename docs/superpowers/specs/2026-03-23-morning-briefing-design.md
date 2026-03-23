# Morning Briefing — Design Spec

**Date:** 2026-03-23
**Phase:** 2.5 (Remaining Planning UI)
**Status:** Approved

---

## Overview

The morning briefing enriches the existing day view (`/today`) with contextual information to help the user start their day. It surfaces today's weather, a handful of news headlines, and a light recap of yesterday — without replacing or disrupting the schedule-focused day view.

The briefing is **in-app only** for this phase. Push notifications are deferred to Phase 5 (native app / Capacitor), where they will be implemented as native push notifications tied to the user's configured wake time.

---

## Goals

- Give the user a quick morning context layer (weather, news, yesterday's recap) within the existing day view
- Allow lightweight adjustments to today's plan from the same screen
- Respect PLND's core principle: this is a planner, not a calorie tracker or anxiety machine — the briefing should feel calm and helpful, not overwhelming

---

## Architecture

### URL & routing

No route changes. `/today` continues to redirect to `/day/:date` (today's ISO date). The generic `/day/:date` route continues to render `DayViewComponent`.

`DayViewComponent` gains an `isToday` computed signal (date param vs. `todayIso()`). When true, it renders two new components around the schedule list:

```
/today → (redirect) → /day/2026-03-23
                              ↓
                      DayViewComponent
                        @if (isToday) {
                          <app-briefing-header />   ← above day header
                        }
                        <app-day-header />
                        <schedule list>
                        @if (isToday) {
                          <app-yesterday-snapshot />  ← below schedule
                        }
```

When `isToday` is false (any past or future date), `DayViewComponent` renders exactly as it does today — no briefing components, no changes.

### New components

| Component | Location | Responsibility |
|---|---|---|
| `BriefingHeaderComponent` | `features/schedule/components/briefing-header/` | Weather card + news headlines card, side by side |
| `YesterdaySnapshotComponent` | `features/schedule/components/yesterday-snapshot/` | Light yesterday recap (tasks done, meals logged) |

### New service

`BriefingService` (`core/services/briefing.service.ts`) — signals-based, matching the existing service pattern. Exposes per-section signals:

```typescript
readonly weather        = this._weather.asReadonly();        // WeatherSummary | null
readonly news           = this._news.asReadonly();           // NewsHeadline[] | null
readonly yesterday      = this._yesterday.asReadonly();      // YesterdaySnapshot | null
readonly weatherError   = this._weatherError.asReadonly();   // string | null
readonly newsError      = this._newsError.asReadonly();      // string | null
readonly yesterdayError = this._yesterdayError.asReadonly(); // string | null
```

`DayViewComponent` calls `briefingService.load()` when `isToday`. All three fetches fire in parallel; each section fails independently.

---

## Layout

**Option B (card panel)** — selected during design review.

`BriefingHeaderComponent` renders two side-by-side rounded cards above the day header navigation:

- **Left card (weather):** icon, current temperature, condition label, high/low for the day
- **Right card (news):** "Headlines" label + 2–3 headline strings

`YesterdaySnapshotComponent` renders a light muted strip below the schedule list: e.g. "Yesterday: 4 of 6 tasks done · All 3 meals logged". No nutrition figures, no calorie framing.

---

## Data & API Layer

Three new backend endpoints, all under a `/briefing` protected router:

### `GET /briefing/weather`

Proxies a weather API (Open-Meteo — free, no API key required). Returns:

```json
{
  "temp_c": 14,
  "condition": "Light rain",
  "high_c": 17,
  "low_c": 11,
  "precipitation_flag": true
}
```

Backend caches response with ~1h TTL (moka cache, matching existing pattern). Frontend never calls weather APIs directly.

### `GET /briefing/news`

Proxies a configurable news/RSS source. Returns 3–5 headline strings:

```json
{
  "headlines": [
    "Tech stocks rebound on Fed signals",
    "Transit strike averted after overnight talks"
  ]
}
```

Backend caches response with ~30 min TTL. News source is configurable via `[external_providers]` in `default.toml`. Personalisation is deferred — generic feed only for this phase.

### `GET /briefing/yesterday`

Computes a summary from existing schedule data for the previous day:

```json
{
  "tasks_done": 4,
  "tasks_total": 6,
  "meals_logged": 3,
  "meals_planned": 3
}
```

No nutrition figures. Count-only, intentionally light.

### Wake time (for future push notifications)

A new `wake_time TIME` column on `user_preferences`, defaulting to `07:00`. Not used for anything in this phase — added now so it can be exposed in Settings and consumed by the Phase 5 push scheduler without a schema migration later.

---

## Quick-Adjust

The briefing does not introduce a separate quick-adjust panel. The day view's existing affordances cover the required actions:

| Action | How |
|---|---|
| Mark done / skip | Existing `scheduleService.toggleItem()` |
| Add item | Existing `AddEntryComponent` |
| Swap meal | Stub (wired to meal library picker once Meal Planning UI is complete) |
| Reschedule to another day | Date-picker action on task/meal row — deferred to drag-and-drop phase |

---

## Push Notifications

**Deferred to Phase 5 (native app).** Native push notifications (via Capacitor) are a better fit than Web Push, which is unreliable and requires service worker infrastructure. The `wake_time` preference column is added now so the data model is ready.

---

## Error Handling

Each briefing section (weather, news, yesterday) fails independently. A broken news API does not blank out the weather card. Each card/section renders a subtle "unavailable" state (e.g. greyed-out placeholder) when its fetch fails. The schedule list is unaffected by any briefing errors.

---

## Testing

### Angular

- `BriefingService` — unit tests with `HttpTestingController`; one spec per section (weather, news, yesterday), including error path
- `BriefingHeaderComponent` — component spec with mock service signals; verify unavailable state renders correctly
- `YesterdaySnapshotComponent` — component spec; verify count display and unavailable state
- `DayViewComponent` — existing spec gains `isToday` assertion: briefing components present for today's date, absent for any other date

### Rust

- Unit tests for each `/briefing/*` handler
- Weather and news route tests cover cache hit/miss behavior
- Wake time column covered by migration test

### E2e

Deferred for this phase. Briefing data sources are external and would require additional mock infrastructure. Unit and component coverage is sufficient.

---

## PLANNING.md Task Breakdown

This spec maps to the following new tasks under Phase 2.5:

1. **Briefing data model** — Add `wake_time` column to `user_preferences` (migration + Rust model update)
2. **Briefing backend routes** — `/briefing/weather`, `/briefing/news`, `/briefing/yesterday` with caching
3. **BriefingService (Angular)** — signals-based service, parallel fetches, per-section error signals
4. **BriefingHeaderComponent** — weather + news card panel, unavailable states
5. **YesterdaySnapshotComponent** — light recap strip, unavailable state
6. **DayViewComponent `isToday` wiring** — conditional render of briefing components; update existing spec

---

## Out of Scope (this phase)

- Push notifications (Phase 5)
- Personalised news feed
- Drag-and-drop rescheduling
- Nutrition figures in the yesterday snapshot
- News source configurability in Settings UI
