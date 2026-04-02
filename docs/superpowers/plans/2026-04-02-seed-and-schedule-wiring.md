# Seed + Schedule Wiring Implementation Plan (Issues #144 → #145)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a `testuser` dev account with realistic schedule data, then replace the `setTimeout` + `mockItems()` stub in `schedule.service.ts` with a real `GET /schedule/period` API call.

**Architecture:** `dev_user.rs` follows the raw-sqlx pattern established by `dishes.rs` — no `plnd_data::db` abstraction layer (which returns `DatabaseError`, not `sqlx::Error`). The Angular service injects `ConfigService` for `apiBase` and `HttpClient` for the HTTP call, mapping `ScheduleEntryDto` (already defined in `week-plan.ts`) to the existing `ScheduleItem` union type.

**Tech Stack:** Rust / sqlx 0.8 / chrono 0.4 / Angular 18 / Angular HttpClient / HttpTestingController

**Dependencies:** Issue #145 is blocked by #144. Complete all of Track A before starting Track B (#146 / #147).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `plnd_seed/Cargo.toml` | Add `chrono` dep and sqlx `chrono` feature |
| Create | `plnd_seed/src/dev_user.rs` | All testuser seed logic |
| Modify | `plnd_seed/src/lib.rs` | Expose `pub mod dev_user` |
| Modify | `plnd_seed/src/bin/seed.rs` | Call `dev_user::seed_dev_user` after catalog seed |
| Modify | `plnd_client/src/app/core/services/schedule.service.ts` | Replace mock with HttpClient + mapping |
| Modify | `plnd_client/src/app/core/services/schedule.service.spec.ts` | Replace fakeAsync/tick with HttpTestingController |

---

## Task 1: Add chrono dep and create dev_user skeleton

**Files:**
- Modify: `plnd_seed/Cargo.toml`
- Create: `plnd_seed/src/dev_user.rs`

- [ ] **Step 1: Add chrono to plnd_seed/Cargo.toml**

In `plnd_seed/Cargo.toml`, change the sqlx line and add chrono:

```toml
sqlx = { version = "0.8", features = ["postgres", "uuid", "runtime-tokio", "json", "rust_decimal", "chrono"] }
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Create plnd_seed/src/dev_user.rs with skeleton + idempotency guard**

```rust
use chrono::{Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::error::SeedError;

const DEV_EMAIL: &str = "testuser@mock.plnd";
const DEV_DISPLAY_NAME: &str = "testuser";
const MOCK_PROVIDER: &str = "mock";
const MOCK_SUB: &str = "testuser";

/// Seed the dev user, their OAuth provider row, preferences, personal meal library,
/// and ~38 days of schedule entries.
///
/// **Idempotent**: if `testuser@mock.plnd` already exists the function returns
/// `Ok(())` immediately without modifying the database.
pub async fn seed_dev_user(pool: &PgPool) -> Result<(), SeedError> {
    let already_seeded: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)",
    )
    .bind(DEV_EMAIL)
    .fetch_one(pool)
    .await?;

    if already_seeded {
        println!("Dev user seed: testuser already exists, skipping.");
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    let user_id = insert_user(&mut *tx).await?;
    insert_oauth_provider(&mut *tx, user_id).await?;
    insert_preferences(&mut *tx, user_id).await?;
    let user_dish_ids = fork_catalog_dishes(&mut *tx, user_id).await?;
    fork_catalog_meals(&mut *tx, user_id, &user_dish_ids).await?;
    seed_schedule(&mut *tx, user_id).await?;
    tx.commit().await?;

    println!("Dev user seed: testuser created with schedule data.");
    Ok(())
}
```

- [ ] **Step 3: Expose the module in lib.rs**

In `plnd_seed/src/lib.rs`, add after the existing `pub mod` lines:

```rust
pub mod dev_user;
```

- [ ] **Step 4: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly (dev_user functions not yet defined — add stubs or define inline).

---

## Task 2: Insert user, OAuth provider, and preferences rows

**Files:**
- Modify: `plnd_seed/src/dev_user.rs`

- [ ] **Step 1: Add the three insert functions to dev_user.rs**

Append to `plnd_seed/src/dev_user.rs`:

```rust
async fn insert_user(tx: &mut PgConnection) -> Result<Uuid, SeedError> {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (user_id, email, display_name, is_active, onboarding_completed)
         VALUES ($1, $2, $3, true, true)",
    )
    .bind(user_id)
    .bind(DEV_EMAIL)
    .bind(DEV_DISPLAY_NAME)
    .execute(tx)
    .await?;
    Ok(user_id)
}

async fn insert_oauth_provider(tx: &mut PgConnection, user_id: Uuid) -> Result<(), SeedError> {
    // provider_type = "mock" and provider_user_id = "testuser" must match what
    // navikt/mock-oauth2-server sends and what plnd_data::db::users::find_by_provider
    // looks up (JOIN oauth_providers ON provider_type = $1 AND provider_user_id = $2).
    sqlx::query(
        "INSERT INTO oauth_providers (provider_id, user_id, provider_type, provider_user_id)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(MOCK_PROVIDER)
    .bind(MOCK_SUB)
    .execute(tx)
    .await?;
    Ok(())
}

async fn insert_preferences(tx: &mut PgConnection, user_id: Uuid) -> Result<(), SeedError> {
    // Columns added across migrations 0003, 0015, 0016.
    // week_start_day=1 (Monday), planning_trigger_offset=-3 (plan 3 days early),
    // default_plan_length_days=7, wake_time='07:00'.
    sqlx::query(
        "INSERT INTO user_preferences
             (user_id, week_start_day, planning_trigger_offset, default_plan_length_days, wake_time)
         VALUES ($1, 1, -3, 7, '07:00')",
    )
    .bind(user_id)
    .execute(tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly.

---

## Task 3: Fork catalog dishes and meals into user library

**Files:**
- Modify: `plnd_seed/src/dev_user.rs`

- [ ] **Step 1: Add fork_catalog_dishes function**

Append to `plnd_seed/src/dev_user.rs`:

```rust
async fn fork_catalog_dishes(
    tx: &mut PgConnection,
    user_id: Uuid,
) -> Result<Vec<Uuid>, SeedError> {
    // Grab the first 5 TheMealDB dishes (sorted by name for determinism).
    let rows: Vec<(Uuid, String, Vec<String>)> = sqlx::query_as(
        "SELECT dish_id, name, occasion_tags
         FROM catalog_dishes
         WHERE external_source = 'themealdb'
         ORDER BY name
         LIMIT 5",
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut user_dish_ids = Vec::new();
    for (catalog_dish_id, name, occasion_tags) in &rows {
        let user_dish_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO user_dishes
                 (user_dish_id, user_id, catalog_dish_id, name, occasion_tags)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(user_dish_id)
        .bind(user_id)
        .bind(catalog_dish_id)
        .bind(name)
        .bind(occasion_tags)
        .execute(&mut *tx)
        .await?;
        user_dish_ids.push(user_dish_id);
    }
    Ok(user_dish_ids)
}
```

- [ ] **Step 2: Add fork_catalog_meals function**

Append to `plnd_seed/src/dev_user.rs`:

```rust
async fn fork_catalog_meals(
    tx: &mut PgConnection,
    user_id: Uuid,
    user_dish_ids: &[Uuid],
) -> Result<(), SeedError> {
    // Create one user_meal per standard slot, each referencing a forked user_dish.
    let slots: &[(&str, &str)] = &[
        ("Breakfast", "breakfast"),
        ("Lunch",     "lunch"),
        ("Dinner",    "dinner"),
    ];

    for (i, (meal_name, slot)) in slots.iter().enumerate() {
        let user_meal_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO user_meals (user_meal_id, user_id, name, occasion_tags)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(user_meal_id)
        .bind(user_id)
        .bind(meal_name)
        .bind(vec![slot.to_string()])
        .execute(&mut *tx)
        .await?;

        // Link a forked dish to this meal (best-effort — skip if we don't have one).
        if let Some(&user_dish_id) = user_dish_ids.get(i) {
            sqlx::query(
                "INSERT INTO user_meal_dishes
                     (user_meal_dish_id, user_meal_id, user_dish_id, dish_servings)
                 VALUES ($1, $2, $3, 1)",
            )
            .bind(Uuid::new_v4())
            .bind(user_meal_id)
            .bind(user_dish_id)
            .execute(&mut *tx)
            .await?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly.

---

## Task 4: Seed schedule entries (historical + forward)

**Files:**
- Modify: `plnd_seed/src/dev_user.rs`

- [ ] **Step 1: Add the schedule seeding helpers**

Append to `plnd_seed/src/dev_user.rs`:

```rust
async fn seed_schedule(tx: &mut PgConnection, user_id: Uuid) -> Result<(), SeedError> {
    let today = Utc::now().date_naive();

    // 30 days of completed history
    for days_back in 1i64..=30 {
        seed_day(tx, user_id, today - Duration::days(days_back), "completed").await?;
    }

    // Today: completed (the day has passed by the time dev loads the app)
    seed_day(tx, user_id, today, "completed").await?;

    // 7 days forward: planned
    for days_forward in 1i64..=7 {
        seed_day(tx, user_id, today + Duration::days(days_forward), "planned").await?;
    }

    Ok(())
}

/// Seed one day's worth of entries: morning exercise, breakfast, lunch, dinner.
/// `status` is "completed" for past/today or "planned" for future days.
async fn seed_day(
    tx: &mut PgConnection,
    user_id: Uuid,
    date: NaiveDate,
    status: &str,
) -> Result<(), SeedError> {
    // (task_type, wall-clock time "HH:MM", after_milepost)
    let entries: &[(&str, &str, Option<&str>)] = &[
        ("exercise", "07:00", None),
        ("meal",     "08:00", Some("breakfast")),
        ("meal",     "12:30", Some("lunch")),
        ("meal",     "18:30", Some("dinner")),
    ];

    for (task_type, hhmm, after_milepost) in entries {
        let t = NaiveTime::parse_from_str(hhmm, "%H:%M")
            .expect("hardcoded time strings are valid");
        let scheduled_start = Utc.from_utc_datetime(&date.and_time(t));

        sqlx::query(
            "INSERT INTO schedule_entries
                 (entry_id, user_id, task_type, date, scheduled_start, status, after_milepost)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(task_type)
        .bind(date)
        .bind(scheduled_start)
        .bind(status)
        .bind(after_milepost)
        .execute(&mut *tx)
        .await?;
    }

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

```bash
just verify-build
```

Expected: compiles cleanly with no warnings.

---

## Task 5: Wire dev_user into the seed binary and verify

**Files:**
- Modify: `plnd_seed/src/bin/seed.rs`

- [ ] **Step 1: Call seed_dev_user after catalog seed in bin/seed.rs**

In `plnd_seed/src/bin/seed.rs`, after the `plnd_seed::seed(...)` call and before `println!("Done.")`:

```rust
    println!("Running dev user seed...");
    plnd_seed::dev_user::seed_dev_user(&pool).await?;
    println!("Dev user seed complete.");
```

The full updated `main` body:

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .or_else(|_| std::env::var("APP_DATABASE__URL"))
        .map_err(|_| anyhow::anyhow!("DATABASE_URL or APP_DATABASE__URL must be set"))?;

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    let usda_key = std::env::var("USDA_FDC_API_KEY")
        .or_else(|_| std::env::var("APP_EXTERNAL__USDA_FDC_API_KEY"))
        .unwrap_or_default();
    let mdb_key = std::env::var("THEMEALDB_API_KEY")
        .or_else(|_| std::env::var("APP_EXTERNAL__THEMEALDB_API_KEY"))
        .unwrap_or_else(|_| "1".to_string());

    let off_base_url = std::env::var("OFF_BASE_URL")
        .unwrap_or_else(|_| "https://world.openfoodfacts.net".to_string());
    let off_basic_auth_user =
        std::env::var("OFF_BASIC_AUTH_USER").unwrap_or_else(|_| "off".to_string());
    let off_basic_auth = if off_basic_auth_user.is_empty() {
        None
    } else {
        let pass = std::env::var("OFF_BASIC_AUTH_PASSWORD").unwrap_or_else(|_| "off".to_string());
        Some((off_basic_auth_user, pass))
    };

    let nutrition_providers: Vec<Arc<dyn NutritionProvider>> = vec![
        Arc::new(UsdaFdcProvider::new(&usda_key)),
        Arc::new(OpenFoodFactsProvider::new(&off_base_url, off_basic_auth)),
    ];
    let recipe_providers: Vec<Arc<dyn RecipeProvider>> =
        vec![Arc::new(TheMealDbProvider::new(&mdb_key))];

    println!("Running catalog seed from external providers...");
    plnd_seed::seed(&pool, &nutrition_providers, &recipe_providers).await?;

    println!("Running dev user seed...");
    plnd_seed::dev_user::seed_dev_user(&pool).await?;
    println!("Dev user seed complete.");

    println!("Done.");
    Ok(())
}
```

- [ ] **Step 2: Verify full build**

```bash
just verify-build
```

Expected: compiles cleanly.

- [ ] **Step 3: Run server startup test**

```bash
just test-run-server
```

Expected: server starts, no panics or errors in output.

- [ ] **Step 4: Commit**

```bash
git add plnd_seed/Cargo.toml plnd_seed/src/dev_user.rs plnd_seed/src/lib.rs plnd_seed/src/bin/seed.rs
git commit -m "feat(seed): add dev user with schedule data for testuser (#144)"
```

---

## Task 6: Replace mock in schedule.service.ts with HttpClient

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`

> **Before touching the file**, read the current `ScheduleEntryDto` and `SchedulePeriodResponse` types in `plnd_client/src/app/core/models/week-plan.ts` — they are already defined there and we reuse them, no new types needed.

The API endpoint is `GET /schedule/period?start=<date>&end=<date>`.  
For a single-day load, `start` and `end` are both the requested date.

- [ ] **Step 1: Write the failing test** (in step 7 — do that task first; come back here after)

Actually follow TDD order: write the spec first (Task 7), then implement.

---

## Task 7: Update schedule.service.spec.ts for HttpClient

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.spec.ts`

- [ ] **Step 1: Write new failing tests**

Replace the entire file with:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ScheduleService } from './schedule.service';
import { isMealAnchor, ScheduleTask } from '../models/schedule';
import { ConfigService } from './config.service';

const MOCK_CONFIG = { api: { baseUrl: 'http://localhost:3000' } };

describe('ScheduleService', () => {
  let svc: ScheduleService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { getConfig: () => MOCK_CONFIG } },
      ],
    });
    svc = TestBed.inject(ScheduleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts with empty items and not loading', () => {
    expect(svc.scheduleItems()).toEqual([]);
    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay sets isLoading then clears it after response', () => {
    svc.loadDay('2026-04-02');
    expect(svc.isLoading()).toBeTrue();

    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });

    expect(svc.isLoading()).toBeFalse();
  });

  it('loadDay GETs /schedule/period with start and end both set to the date', () => {
    svc.loadDay('2026-04-02');

    const req = httpMock.expectOne(r => r.url.includes('/schedule/period'));
    expect(req.request.params.get('start')).toBe('2026-04-02');
    expect(req.request.params.get('end')).toBe('2026-04-02');
    req.flush({ entries: [], carryover: [] });
  });

  it('loadDay records the requested date', () => {
    svc.loadDay('2026-04-01');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });
    expect(svc.date()).toBe('2026-04-01');
  });

  it('maps a task entry to ScheduleTask', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 'e1',
        task_type: 'exercise',
        title: 'Morning run',
        status: 'completed',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T07:00:00Z',
      }],
      carryover: [],
    });

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    const task = items[0] as ScheduleTask;
    expect(task.id).toBe('e1');
    expect(task.type).toBe('exercise');
    expect(task.label).toBe('Morning run');
    expect(task.status).toBe('done');
  });

  it('maps a meal entry to MealAnchor', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 'm1',
        task_type: 'meal',
        title: null,
        after_milepost: 'breakfast',
        status: 'planned',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T08:00:00Z',
      }],
      carryover: [],
    });

    const items = svc.scheduleItems();
    expect(items.length).toBe(1);
    expect(isMealAnchor(items[0])).toBeTrue();
    const meal = items[0] as any;
    expect(meal.name).toBe('Breakfast');
    expect(meal.status).toBe('planned');
  });

  it('sets items to [] and clears loading on HTTP error', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush('server error', { status: 500, statusText: 'Internal Server Error' });

    expect(svc.isLoading()).toBeFalse();
    expect(svc.scheduleItems()).toEqual([]);
  });

  it('toggleItem flips a task from pending to done', () => {
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [{
        entry_id: 't3',
        task_type: 'custom',
        title: 'Reply to dentist email',
        status: 'planned',
        date: '2026-04-02',
        scheduled_start: '2026-04-02T10:00:00Z',
      }],
      carryover: [],
    });
    const task = svc.scheduleItems()[0] as ScheduleTask;
    expect(task.status).toBe('pending');
    svc.toggleItem('t3');
    expect((svc.scheduleItems()[0] as ScheduleTask).status).toBe('done');
  });

  it('toggleItem flips a during-meal task', () => {
    // duringMealTasks come from within a MealAnchor — toggleItem must find nested tasks
    svc.loadDay('2026-04-02');
    httpMock.expectOne(r => r.url.includes('/schedule/period'))
      .flush({ entries: [], carryover: [] });
    // Manually inject a MealAnchor with a duringMealTask to test toggle logic
    (svc as any)._items.set([{
      id: 'm1', name: 'Breakfast', emoji: '🥣',
      status: 'planned', duringMealTasks: [
        { id: 't-dm2', type: 'task', label: 'Read 10 pages', status: 'pending' }
      ]
    }]);
    svc.toggleItem('t-dm2');
    const meal = svc.scheduleItems()[0] as any;
    expect(meal.duringMealTasks[0].status).toBe('done');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
just test-ng-headless
```

Expected: FAIL — `ConfigService` injection errors or HTTP call never made.

---

## Task 8: Implement the real schedule.service.ts

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`

- [ ] **Step 1: Replace schedule.service.ts**

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { ConfigService } from './config.service';
import { ScheduleItem, ItemType, MealAnchor, ScheduleTask, isMealAnchor } from '../models/schedule';
import { ScheduleEntryDto, SchedulePeriodResponse } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  private readonly _items   = signal<ScheduleItem[]>([]);
  private readonly _loading = signal(false);
  private readonly _error   = signal<string | null>(null);
  private readonly _date    = signal(todayIso());

  readonly scheduleItems = this._items.asReadonly();
  readonly isLoading     = this._loading.asReadonly();
  readonly loadError     = this._error.asReadonly();
  readonly date          = this._date.asReadonly();

  loadDay(date: string): void {
    this._date.set(date);
    this._loading.set(true);
    this._error.set(null);

    this.http
      .get<SchedulePeriodResponse>(`${this.apiBase}/schedule/period`, {
        params: { start: date, end: date },
      })
      .pipe(catchError(() => of({ entries: [], carryover: [] } satisfies SchedulePeriodResponse)))
      .subscribe(resp => {
        if (this._date() !== date) return; // stale response guard
        this._items.set(resp.entries.map(mapEntry));
        this._loading.set(false);
      });
  }

  toggleItem(id: string): void {
    this._items.update(items =>
      items.map(item => {
        if (isMealAnchor(item)) {
          if (!item.duringMealTasks.some(t => t.id === id)) return item;
          return {
            ...item,
            duringMealTasks: item.duringMealTasks.map(t =>
              t.id === id ? { ...t, status: flip(t.status) } : t,
            ),
          };
        }
        return item.id === id ? { ...item, status: flip(item.status) } : item;
      }),
    );
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function flip(status: 'pending' | 'done'): 'pending' | 'done' {
  return status === 'done' ? 'pending' : 'done';
}

// ── API → model mapping ───────────────────────────────────────────────────────

const MEAL_SLOTS: Record<string, { name: string; emoji: string }> = {
  breakfast: { name: 'Breakfast', emoji: '🥣' },
  lunch:     { name: 'Lunch',     emoji: '🥗' },
  dinner:    { name: 'Dinner',    emoji: '🍽' },
};

function mapEntry(e: ScheduleEntryDto): ScheduleItem {
  if (e.task_type === 'meal') {
    const slot = e.after_milepost ? MEAL_SLOTS[e.after_milepost] : undefined;
    return {
      id:    e.entry_id,
      name:  slot?.name ?? e.title ?? 'Meal',
      emoji: slot?.emoji ?? '🍴',
      description: e.title ?? undefined,
      status: e.status === 'completed' ? 'done'
            : e.status === 'planned'   ? 'planned'
            : 'unplanned',
      duringMealTasks: [],
    } satisfies MealAnchor;
  }

  const TYPE_MAP: Record<string, ItemType> = {
    exercise:    'exercise',
    appointment: 'appointment',
  };
  return {
    id:     e.entry_id,
    type:   TYPE_MAP[e.task_type] ?? 'task',
    label:  e.title ?? e.task_type,
    status: e.status === 'completed' ? 'done' : 'pending',
  } satisfies ScheduleTask;
}
```

- [ ] **Step 2: Run tests**

```bash
just test-ng-headless
```

Expected: all tests in `schedule.service.spec.ts` PASS.

- [ ] **Step 3: Verify mock is gone**

```bash
grep -r "mockItems\|setTimeout" plnd_client/src/app/core/services/schedule.service.ts
```

Expected: no output.

- [ ] **Step 4: Run full CI suite**

```bash
just test-ci
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/core/services/schedule.service.ts \
        plnd_client/src/app/core/services/schedule.service.spec.ts
git commit -m "feat(client): wire schedule service to real API, remove mockItems (#145)"
```

---

## Self-Review Checklist

- [ ] `grep -r "mockItems\|setTimeout" plnd_client/src/app/core/services/schedule.service.ts` → no output
- [ ] `just verify` passes cleanly
- [ ] `just test-run-server` starts without error after seed runs
