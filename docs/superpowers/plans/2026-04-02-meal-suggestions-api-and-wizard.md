# Meal Suggestions API + Wizard Wiring Implementation Plan (Issues #146 → #147)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /my/meal-suggestions?date=<date>&slot=<slot>` to the Rust API, then replace `MOCK_MEAL_SUGGESTIONS` / `getMockSuggestion()` in the Angular planning wizard with real API calls via a new `MealSuggestionsService`.

**Architecture:** The API endpoint queries `user_dishes UNION ALL user_meals` filtered by `occasion_tags @> ARRAY[$slot]` and `is_blocked = false`, returning up to 10 results ordered by name. On the Angular side, `MealSuggestionsService` caches per `(date, slot)` key in a `WritableSignal<Map>`, loading on first access; the component calls `load()` for all visible cells in `ngOnInit` and reads from the cached signal in `getSuggestion()`.

**Tech Stack:** Rust / Axum / sqlx 0.8 / Angular 18 / HttpClient / Angular signals

**Dependencies:** Issue #147 is blocked by #146. This track is independent of Track A (#144/#145) and can be worked in parallel.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `plnd_data/src/db/meal_suggestions.rs` | SQL UNION query returning suggestions |
| Modify | `plnd_data/src/db/mod.rs` | Expose `pub mod meal_suggestions` |
| Modify | `plnd_api/src/api_response.rs` | Add `MealSuggestionResponse` struct |
| Create | `plnd_api/src/routes/meal_suggestions.rs` | Route handler for `GET /my/meal-suggestions` |
| Modify | `plnd_api/src/routes/mod.rs` | Expose `pub mod meal_suggestions` |
| Modify | `plnd_api/src/main.rs` | Register route under protected router |
| Create | `plnd_client/src/app/core/services/meal-suggestions.service.ts` | HTTP + signal cache |
| Create | `plnd_client/src/app/core/services/meal-suggestions.service.spec.ts` | Unit tests |
| Modify | `plnd_client/src/app/core/models/week-plan.ts` | Add `MealSuggestion` interface, remove `MOCK_MEAL_SUGGESTIONS` + `getMockSuggestion` |
| Modify | `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts` | Inject service, update `getSuggestion` + `reSuggest` + `ngOnInit` |
| Modify | `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts` | Mock `MealSuggestionsService`, update affected tests |

---

## Task 1: DB query module for meal suggestions

**Files:**
- Create: `plnd_data/src/db/meal_suggestions.rs`
- Modify: `plnd_data/src/db/mod.rs`

- [ ] **Step 1: Write the failing test**

Add a doc-test comment at the top of the file (the DB module pattern here relies on integration-test via the API layer; the unit boundary is the function signature and query shape):

Create `plnd_data/src/db/meal_suggestions.rs`:

```rust
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::error::DatabaseError;

/// A meal or dish returned as a planning suggestion.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MealSuggestion {
    pub id:              Uuid,
    pub name:            String,
    /// "meal" or "dish"
    pub suggestion_type: String,
}

/// Return up to 10 meal/dish suggestions for the given user and slot.
///
/// Results are drawn from `user_meals` and `user_dishes` where:
/// - `occasion_tags` contains `slot` (e.g. "breakfast", "lunch", "dinner", "snack")
/// - `is_blocked = false`
///
/// Ordered by name, limited to 10.
///
/// The `date` parameter is accepted for forward-compatibility (future
/// implementations may filter by recency or season) but is not used in
/// the query today.
#[tracing::instrument(skip(pool), fields(table = "user_meals/user_dishes", op = "suggestions"))]
pub async fn get_suggestions(
    pool: &PgPool,
    user_id: Uuid,
    slot: &str,
    _date: &str,
) -> Result<Vec<MealSuggestion>, DatabaseError> {
    sqlx::query_as::<_, MealSuggestion>(
        r#"
        SELECT user_meal_id AS id,
               name,
               'meal'::TEXT AS suggestion_type
        FROM user_meals
        WHERE user_id = $1
          AND $2 = ANY(occasion_tags)
          AND is_blocked = false

        UNION ALL

        SELECT user_dish_id AS id,
               name,
               'dish'::TEXT AS suggestion_type
        FROM user_dishes
        WHERE user_id = $1
          AND $2 = ANY(occasion_tags)
          AND is_blocked = false

        ORDER BY name
        LIMIT 10
        "#,
    )
    .bind(user_id)
    .bind(slot)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::from)
}
```

- [ ] **Step 2: Expose the module in plnd_data/src/db/mod.rs**

Add after the existing `pub mod` lines:

```rust
pub mod meal_suggestions;
```

- [ ] **Step 3: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly.

---

## Task 2: Add MealSuggestionResponse to api_response.rs

**Files:**
- Modify: `plnd_api/src/api_response.rs`

- [ ] **Step 1: Add the response struct**

In `plnd_api/src/api_response.rs`, add after the existing imports and existing structs:

```rust
/// API response item for `GET /my/meal-suggestions`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MealSuggestionResponse {
    pub id:              Uuid,
    pub name:            String,
    /// "meal" or "dish"
    pub suggestion_type: String,
}

impl From<plnd_data::db::meal_suggestions::MealSuggestion> for MealSuggestionResponse {
    fn from(s: plnd_data::db::meal_suggestions::MealSuggestion) -> Self {
        Self {
            id:              s.id,
            name:            s.name,
            suggestion_type: s.suggestion_type,
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly.

---

## Task 3: Create route handler for meal suggestions

**Files:**
- Create: `plnd_api/src/routes/meal_suggestions.rs`
- Modify: `plnd_api/src/routes/mod.rs`

- [ ] **Step 1: Write the failing test (integration test via curl after wiring)**

The handler test is confirmed via `just test-ci` once the route is registered. We write the handler now and test in Task 4.

Create `plnd_api/src/routes/meal_suggestions.rs`:

```rust
use crate::api_response::MealSuggestionResponse;
use crate::auth::jwt::Claims;
use crate::state::AppState;
use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    Json,
};
use plnd_data::db;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SuggestionsQuery {
    pub date: String,
    pub slot: String,
}

#[utoipa::path(
    get,
    path = "/my/meal-suggestions",
    tag = "Meal Suggestions",
    params(
        ("date" = String, Query, description = "ISO date (YYYY-MM-DD)"),
        ("slot" = String, Query, description = "Meal slot: breakfast | lunch | dinner | snack"),
    ),
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Meal suggestions for the slot", body = Vec<MealSuggestionResponse>),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(state), fields(user_id = %claims.sub))]
pub async fn get_suggestions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SuggestionsQuery>,
) -> Result<Json<Vec<MealSuggestionResponse>>, StatusCode> {
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let pool = state.db.get_pool();

    db::meal_suggestions::get_suggestions(pool, user_id, &params.slot, &params.date)
        .await
        .map(|v| Json(v.into_iter().map(MealSuggestionResponse::from).collect()))
        .map_err(|e| {
            tracing::error!(error = %e, "get_suggestions DB error");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
```

- [ ] **Step 2: Expose the module in plnd_api/src/routes/mod.rs**

Add after the existing `pub mod` lines:

```rust
pub mod meal_suggestions;
```

- [ ] **Step 3: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly.

---

## Task 4: Register route in main.rs and run CI

**Files:**
- Modify: `plnd_api/src/main.rs`

- [ ] **Step 1: Add the route to the protected router in main.rs**

In `plnd_api/src/main.rs`, find the `protected` router block (where `/dietary-restrictions` is registered) and add:

```rust
        .route(
            "/my/meal-suggestions",
            get(meal_suggestions::get_suggestions),
        )
```

The import at the top of main.rs already picks up the routes module — `meal_suggestions` is now a module in `routes/mod.rs`, so it's accessible as `routes::meal_suggestions::get_suggestions`. Verify that the import style matches the existing routes (e.g. `use crate::routes::meal_suggestions;` or via `routes::meal_suggestions::get_suggestions` if routes is already in scope).

- [ ] **Step 2: Verify build and run tests**

```bash
just verify-build
just test-ci
```

Expected: both pass cleanly.

- [ ] **Step 3: Commit the Rust changes**

```bash
git add plnd_data/src/db/meal_suggestions.rs \
        plnd_data/src/db/mod.rs \
        plnd_api/src/api_response.rs \
        plnd_api/src/routes/meal_suggestions.rs \
        plnd_api/src/routes/mod.rs \
        plnd_api/src/main.rs
git commit -m "feat(api): add GET /my/meal-suggestions endpoint (#146)"
```

---

## Task 5: Create MealSuggestionsService in Angular

**Files:**
- Create: `plnd_client/src/app/core/services/meal-suggestions.service.spec.ts`
- Create: `plnd_client/src/app/core/services/meal-suggestions.service.ts`

- [ ] **Step 1: Write the failing spec first**

Create `plnd_client/src/app/core/services/meal-suggestions.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MealSuggestionsService } from './meal-suggestions.service';
import { ConfigService } from './config.service';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };
const MOCK_SUGGESTIONS = [
  { id: 'id-1', name: 'Oatmeal', suggestion_type: 'meal' },
  { id: 'id-2', name: 'Scrambled Eggs', suggestion_type: 'dish' },
];

describe('MealSuggestionsService', () => {
  let svc: MealSuggestionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => MOCK_CONFIG } },
      ],
    });
    svc = TestBed.inject(MealSuggestionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('suggestions() returns [] before any load', () => {
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual([]);
  });

  it('load() fires GET /my/meal-suggestions with date and slot params', () => {
    svc.load('2026-04-02', 'breakfast');

    const req = httpMock.expectOne(r => r.url.includes('/my/meal-suggestions'));
    expect(req.request.params.get('date')).toBe('2026-04-02');
    expect(req.request.params.get('slot')).toBe('breakfast');
    req.flush(MOCK_SUGGESTIONS);
  });

  it('suggestions() returns API results after successful load', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual(MOCK_SUGGESTIONS);
  });

  it('load() is idempotent — does not duplicate requests for same key', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions')).flush(MOCK_SUGGESTIONS);

    svc.load('2026-04-02', 'breakfast'); // second call — no new request
    httpMock.expectNone(r => r.url.includes('/my/meal-suggestions'));
  });

  it('suggestions() returns [] and does not throw on HTTP error', () => {
    svc.load('2026-04-02', 'breakfast');
    httpMock.expectOne(r => r.url.includes('/my/meal-suggestions'))
      .flush('error', { status: 500, statusText: 'Server Error' });
    expect(svc.suggestions('2026-04-02', 'breakfast')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
just test-ng-headless
```

Expected: FAIL — `MealSuggestionsService` does not exist yet.

- [ ] **Step 3: Create the service**

Create `plnd_client/src/app/core/services/meal-suggestions.service.ts`:

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfigService } from './config.service';
import { MealSuggestion, MealSlot } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class MealSuggestionsService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  // Plain Map<key, WritableSignal<MealSuggestion[]>> — not a signal-of-map,
  // because we want each (date, slot) signal to be independently reactive.
  private readonly _cache = new Map<string, ReturnType<typeof signal<MealSuggestion[]>>>();
  private readonly _pending = new Set<string>();

  /** Returns the cached suggestions for a given (date, slot).
   *  Callers MUST call load(date, slot) before reading; reading before load returns []. */
  suggestions(date: string, slot: MealSlot): MealSuggestion[] {
    return this._cache.get(`${date}:${slot}`)?.() ?? [];
  }

  /** Fires a GET /my/meal-suggestions request if no request for this (date, slot) is in-flight
   *  or already cached. Safe to call multiple times. */
  load(date: string, slot: MealSlot): void {
    const key = `${date}:${slot}`;
    if (this._cache.has(key) || this._pending.has(key)) return;

    const sig = signal<MealSuggestion[]>([]);
    this._cache.set(key, sig);
    this._pending.add(key);

    this.http
      .get<MealSuggestion[]>(`${this.apiBase}/my/meal-suggestions`, { params: { date, slot } })
      .subscribe({
        next:  data  => { sig.set(data);  this._pending.delete(key); },
        error: ()    => { sig.set([]);    this._pending.delete(key); },
      });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
just test-ng-headless
```

Expected: all `MealSuggestionsService` tests PASS.

---

## Task 6: Add MealSuggestion interface to week-plan.ts

**Files:**
- Modify: `plnd_client/src/app/core/models/week-plan.ts`

> Do NOT remove `MOCK_MEAL_SUGGESTIONS` or `getMockSuggestion` yet — `plan-meals-step.ts` still imports them. That removal happens in Task 8.

- [ ] **Step 1: Add MealSuggestion interface**

In `plnd_client/src/app/core/models/week-plan.ts`, add after `export const SKIP_SENTINEL`:

```typescript
/** A meal or dish returned by GET /my/meal-suggestions. */
export interface MealSuggestion {
  id:              string;
  name:            string;
  /** "meal" or "dish" */
  suggestion_type: string;
}
```

- [ ] **Step 2: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly (TypeScript check via Angular build).

---

## Task 7: Update plan-meals-step.spec.ts to use MealSuggestionsService mock

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts`

The spec currently relies on `getMockSuggestion()` for suggestion display. After wiring, cells show suggestions from the service. We must provide a mock service before modifying the component, so the spec compiles either way.

- [ ] **Step 1: Add MealSuggestionsService mock provider to the spec**

Replace the `beforeEach` in the spec to provide a mock service. The mock makes `suggestions()` return a fixed array so tests remain deterministic:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealSuggestionsService } from '../../../../core/services/meal-suggestions.service';
import { MealSlot } from '../../../../core/models/week-plan';

const MOCK_SUGGESTIONS = [
  { id: 'id-1', name: 'Oatmeal',         suggestion_type: 'meal' },
  { id: 'id-2', name: 'Scrambled Eggs',  suggestion_type: 'dish' },
  { id: 'id-3', name: 'Yogurt & Fruit',  suggestion_type: 'meal' },
];

describe('PlanMealsStepComponent', () => {
  let fixture: ComponentFixture<PlanMealsStepComponent>;
  let service: WeekPlanService;
  let component: PlanMealsStepComponent;
  let suggestionsSpy: jasmine.SpyObj<MealSuggestionsService>;

  beforeEach(async () => {
    suggestionsSpy = jasmine.createSpyObj('MealSuggestionsService', ['load', 'suggestions']);
    // Default: return mock suggestions for any (date, slot)
    suggestionsSpy.suggestions.and.returnValue(MOCK_SUGGESTIONS);

    await TestBed.configureTestingModule({
      imports: [PlanMealsStepComponent, HttpClientTestingModule],
      providers: [
        { provide: MealSuggestionsService, useValue: suggestionsSpy },
      ],
    }).compileComponents();

    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-23', '2026-03-27');
    fixture = TestBed.createComponent(PlanMealsStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── All existing tests below — unchanged except the reSuggest tests ──

  it('should create', () => expect(component).toBeTruthy());

  it('should render one .gc cell for each day × slot (5 days × 3 slots = 15)', () => {
    const cells = fixture.nativeElement.querySelectorAll('.gc');
    expect(cells.length).toBe(15);
  });

  it('should render 5 day column headers', () => {
    const headers = fixture.nativeElement.querySelectorAll('.cell-day-header');
    expect(headers.length).toBe(5);
  });

  it('should render a slot row label for each slot', () => {
    const labels = fixture.nativeElement.querySelectorAll('.slot-lbl');
    expect(labels.length).toBe(3);
    const text = Array.from(labels).map((l) => (l as HTMLElement).textContent!.trim().toLowerCase());
    expect(text).toContain('breakfast');
    expect(text).toContain('lunch');
    expect(text).toContain('dinner');
  });

  it('should display a suggestion text in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    const text = firstCell.querySelector('.gc-text');
    expect(text).toBeTruthy();
    expect(text!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('should display ✏️ Pick and 🔀 Suggest buttons in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
    expect(firstCell.querySelector('.gc-suggest')).toBeTruthy();
  });

  it('should display the × skip button in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-x')).toBeTruthy();
  });

  it('should apply .skipped-g and show skip text when × is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeTrue();
    expect(firstCell.querySelector('.gc-text.skip-t')).toBeTruthy();
    expect(firstCell.querySelector('.gc-undo')).toBeTruthy();
  });

  it('should restore pending state when undo is clicked on a skipped cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    (firstCell.querySelector('.gc-undo') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeFalse();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should enter editing state and show .mock-input when ✏️ Pick is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('gc-editing')).toBeTrue();
    expect(firstCell.querySelector('.mock-input')).toBeTruthy();
    expect(firstCell.querySelector('.input-hint')).toBeTruthy();
  });

  it('should call setMeal with user_meal on Enter key and exit editing', () => {
    spyOn(service, 'setMeal');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.value = 'Greek yogurt';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(service.setMeal).toHaveBeenCalledWith(
      '2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' },
    );
    expect(firstCell.classList.contains('gc-editing')).toBeFalse();
  });

  it('should not call setMeal and should exit editing on Escape key', () => {
    spyOn(service, 'setMeal');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(service.setMeal).not.toHaveBeenCalled();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should show .custom-g state when a user_meal is already set', () => {
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.classList.contains('custom-g')).toBeTrue();
    const customText = firstCell.querySelector('.gc-text.custom-t');
    expect(customText).toBeTruthy();
    expect(customText!.textContent!.trim()).toBe('Greek yogurt');
    expect(firstCell.querySelector('.gc-edit-custom')).toBeTruthy();
  });

  it('should change suggestion text when 🔀 Suggest is clicked', () => {
    // suggestionsSpy.suggestions returns MOCK_SUGGESTIONS (3 items).
    // reSuggest cycles from index 0 (Oatmeal) to index 1 (Scrambled Eggs).
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
    fixture.detectChanges();
    const after = firstCell.querySelector('.gc-text')!.textContent!.trim();
    // The cycled-to name must be one of the mock suggestions
    expect(MOCK_SUGGESTIONS.map(s => s.name)).toContain(after);
  });

  it('should persist the cycled suggestion to the service when 🔀 Suggest is clicked', () => {
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
    fixture.detectChanges();
    const stored = service.scheduledMeals()['2026-03-23']?.['breakfast'];
    expect(stored).toBeTruthy();
    expect(stored!.type).toBe('mock');
  });

  it('should pre-fill edit input with existing custom meal title', () => {
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-edit-custom') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    expect(input.value).toBe('Overnight oats');
  });

  it('should clear custom meal back to pending when × is clicked in custom state', () => {
    spyOn(service, 'clearMeal');
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.clearMeal).toHaveBeenCalledWith('2026-03-23', 'breakfast');
  });
});
```

> **Note:** The "persist suggestion" test still uses `firstCell` — it must be moved inside `it()` as a local variable. Fix it:
> ```typescript
> it('should persist...', () => {
>   const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
>   (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
>   ...
> });
> ```

- [ ] **Step 2: Run tests (expect some to fail until component is updated)**

```bash
just test-ng-headless
```

Expected: `MealSuggestionsService` provider errors OR tests pass because old component still compiles. Note current state.

---

## Task 8: Wire plan-meals-step.ts and remove mock helpers from week-plan.ts

**Files:**
- Modify: `plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts`
- Modify: `plnd_client/src/app/core/models/week-plan.ts`

- [ ] **Step 1: Update the import line in plan-meals-step.ts**

Change the import from `week-plan` to drop the mock helpers and add `MealSuggestion`:

```typescript
import {
  MealSlot, PlannedMeal, MealSuggestion, SKIP_SENTINEL, STANDARD_MEAL_SLOTS,
} from '../../../../core/models/week-plan';
```

- [ ] **Step 2: Inject MealSuggestionsService**

In `plan-meals-step.ts`, add the injection and `ngOnInit`:

```typescript
import { Component, OnInit, computed, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { MealSuggestionsService } from '../../../../core/services/meal-suggestions.service';

// ... inside the class:
export class PlanMealsStepComponent implements OnInit {
  private readonly weekPlanService      = inject(WeekPlanService);
  private readonly mealSuggestionsService = inject(MealSuggestionsService);

  // ... existing fields ...

  ngOnInit(): void {
    // Load suggestions for all visible (day, slot) pairs.
    // MealSuggestionsService.load() is idempotent — safe to call multiple times.
    for (const day of this.horizonDays()) {
      for (const slot of this.slots) {
        this.mealSuggestionsService.load(day, slot as MealSlot);
      }
    }
  }
```

- [ ] **Step 3: Update getSuggestion to read from service**

Replace the existing `getSuggestion` method:

```typescript
  /** Returns the displayed suggestion for a pending cell.
   *  Prefers a user-persisted 'mock' title; falls back to the first API suggestion. */
  getSuggestion(date: string, slot: MealSlot): string {
    const stored = this.getMeal(date, slot);
    if (stored?.type === 'mock') return stored.title;
    const list = this.mealSuggestionsService.suggestions(date, slot);
    return list[0]?.name ?? '—';
  }
```

- [ ] **Step 4: Update reSuggest to cycle through service suggestions**

Replace the existing `reSuggest` method:

```typescript
  /** Cycles to the next API suggestion and persists it so implicit acceptance uses the chosen one. */
  reSuggest(date: string, slot: MealSlot): void {
    const list = this.mealSuggestionsService.suggestions(date, slot);
    if (!list.length) return;
    const currentTitle = this.getMeal(date, slot)?.title;
    const currentIndex = list.findIndex(s => s.name === currentTitle);
    const next = list[(currentIndex + 1) % list.length];
    this.weekPlanService.setMeal(date, slot, { type: 'mock', title: next.name });
  }
```

- [ ] **Step 5: Remove MOCK_MEAL_SUGGESTIONS and getMockSuggestion from week-plan.ts**

In `plnd_client/src/app/core/models/week-plan.ts`, delete these two exports:

```typescript
// DELETE these lines entirely:
export const MOCK_MEAL_SUGGESTIONS: string[] = [
  'Oatmeal', 'Scrambled Eggs', 'Yogurt & Fruit',
  'Salad', 'Sandwich', 'Soup',
  'Pasta', 'Stir Fry', 'Grilled Chicken',
  'Smoothie', 'Leftovers',
];

// TODO(phase-3): replace mock array with WeekPlanService.getMealSuggestions()
export function getMockSuggestion(date: string, slot: MealSlot): string {
  const hash = date.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const slotIndex = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(slot);
  return MOCK_MEAL_SUGGESTIONS[(hash + slotIndex) % MOCK_MEAL_SUGGESTIONS.length];
}
```

- [ ] **Step 6: Verify grep shows no mock references outside spec files**

```bash
grep -r "MOCK_MEAL_SUGGESTIONS\|getMockSuggestion" plnd_client/src/app
```

Expected: no output (both symbols are gone from production code).

- [ ] **Step 7: Run Angular tests**

```bash
just test-ng-headless
```

Expected: all tests PASS.

- [ ] **Step 8: Run full CI**

```bash
just test-ci
```

Expected: all tests PASS.

- [ ] **Step 9: Run full verify**

```bash
just verify
```

Expected: passes cleanly.

- [ ] **Step 10: Commit**

```bash
git add plnd_client/src/app/core/models/week-plan.ts \
        plnd_client/src/app/core/services/meal-suggestions.service.ts \
        plnd_client/src/app/core/services/meal-suggestions.service.spec.ts \
        plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts \
        plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.spec.ts
git commit -m "feat(client): wire planning wizard to meal suggestions endpoint, remove mock helpers (#147)"
```

---

## Self-Review Checklist

- [ ] `grep -r "MOCK_MEAL_SUGGESTIONS\|getMockSuggestion" plnd_client/src/app` → no matches outside `.spec.ts`
- [ ] `just verify` passes cleanly
- [ ] `just test-ci` passes cleanly
