use chrono::{Duration, NaiveDate, NaiveTime, Utc};
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
    let already_seeded: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
            .bind(DEV_EMAIL)
            .fetch_one(pool)
            .await?;

    if already_seeded {
        println!("Dev user seed: {} already exists, skipping.", DEV_EMAIL);
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    let user_id = insert_user(&mut tx).await?;
    insert_oauth_provider(&mut tx, user_id).await?;
    insert_preferences(&mut tx, user_id).await?;
    let day_type_id = insert_default_day_type(&mut tx, user_id).await?;
    insert_meal_pattern_entries(&mut tx, day_type_id).await?;
    let user_dish_ids = fork_catalog_dishes(&mut tx, user_id).await?;
    fork_catalog_meals(&mut tx, user_id, &user_dish_ids).await?;
    seed_schedule(&mut tx, user_id).await?;
    tx.commit().await?;

    println!("Dev user seed: testuser created with schedule data.");
    Ok(())
}

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
    sqlx::query(
        "INSERT INTO user_preferences
             (user_id, week_start_day, planning_trigger_offset, default_plan_length_days)
         VALUES ($1, 1, -3, 7)",
    )
    .bind(user_id)
    .execute(tx)
    .await?;
    Ok(())
}

async fn insert_default_day_type(tx: &mut PgConnection, user_id: Uuid) -> Result<Uuid, SeedError> {
    let day_type_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO user_day_types
             (id, user_id, name, days_bitmask, wake_time, sleep_time, is_cycle)
         VALUES ($1, $2, $3, $4, $5::time, $6::time, false)",
    )
    .bind(day_type_id)
    .bind(user_id)
    .bind("Everyday")
    .bind(127i32)
    .bind("07:00:00")
    .bind("22:00:00")
    .execute(&mut *tx)
    .await?;
    Ok(day_type_id)
}

async fn insert_meal_pattern_entries(
    tx: &mut PgConnection,
    day_type_id: Uuid,
) -> Result<(), SeedError> {
    let entries: &[(&str, &str, i32, i32)] = &[
        ("breakfast", "08:00:00", 60, 1),
        ("lunch", "12:00:00", 60, 2),
        ("dinner", "18:00:00", 60, 3),
    ];
    for (name, preferred_time, tolerance_minutes, sort_order) in entries {
        sqlx::query(
            "INSERT INTO meal_pattern_entries
                 (day_type_id, name, preferred_time, tolerance_minutes, sort_order)
             VALUES ($1, $2, $3::time, $4, $5)",
        )
        .bind(day_type_id)
        .bind(name)
        .bind(preferred_time)
        .bind(tolerance_minutes)
        .bind(sort_order)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

async fn fork_catalog_dishes(tx: &mut PgConnection, user_id: Uuid) -> Result<Vec<Uuid>, SeedError> {
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

async fn fork_catalog_meals(
    tx: &mut PgConnection,
    user_id: Uuid,
    user_dish_ids: &[Uuid],
) -> Result<(), SeedError> {
    // Create one user_meal per standard slot, each referencing a forked user_dish.
    let slots: &[(&str, &str)] = &[
        ("Breakfast", "breakfast"),
        ("Lunch", "lunch"),
        ("Dinner", "dinner"),
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

/// Seed one day's worth of entries: morning exercise task + three meal anchor instances.
/// `status` is "completed" for past/today or "planned" for future days.
async fn seed_day(
    tx: &mut PgConnection,
    user_id: Uuid,
    date: NaiveDate,
    status: &str,
) -> Result<(), SeedError> {
    // One task entry: morning exercise. scheduled_start is a wall-clock TIME
    // (#936); the row's `date` column supplies the calendar day.
    let scheduled_start = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
    sqlx::query(
        "INSERT INTO schedule_entries
             (entry_id, user_id, task_type, date, scheduled_start, status)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind("exercise")
    .bind(date)
    .bind(scheduled_start)
    .bind(status)
    .execute(&mut *tx)
    .await?;

    // Meal anchors — belong in meal_anchor_instances, not schedule_entries.
    // Marker ensures the day is treated as materialized.
    sqlx::query(
        "INSERT INTO meal_anchor_materializations (user_id, date) VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(date)
    .execute(&mut *tx)
    .await?;

    let meals: &[(&str, &str, i32, i32)] = &[
        ("breakfast", "08:00:00", 60, 0),
        ("lunch", "12:30:00", 60, 1),
        ("dinner", "18:30:00", 60, 2),
    ];
    for (name, preferred_time, tolerance, sort_order) in meals {
        sqlx::query(
            "INSERT INTO meal_anchor_instances
                 (id, user_id, date, name, preferred_time, tolerance_minutes, sort_order)
             VALUES ($1, $2, $3, $4, $5::time, $6, $7)
             ON CONFLICT (user_id, date, name) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(date)
        .bind(name)
        .bind(preferred_time)
        .bind(tolerance)
        .bind(*sort_order)
        .execute(&mut *tx)
        .await?;
    }

    Ok(())
}
