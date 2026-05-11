use sqlx::PgConnection;
use uuid::Uuid;

use crate::dishes::AUTO_SEEDED_TAG;
use crate::error::SeedError;

struct MealDef {
    name: &'static str,
    description: &'static str,
    slug: &'static str,
    occasion_tags: &'static [&'static str],
    tags: &'static [&'static str],
    dish_keywords: &'static [&'static str],
}

const MEALS: &[MealDef] = &[
    // Breakfasts (3)
    MealDef {
        name: "Morning Porridge",
        description: "Warming oat porridge to start the day",
        slug: "breakfast-morning-porridge",
        occasion_tags: &["breakfast"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["porridge"],
    },
    MealDef {
        name: "Scrambled Egg Plate",
        description: "Classic scrambled eggs with toast",
        slug: "breakfast-scrambled-egg-plate",
        occasion_tags: &["breakfast"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["scrambled", "egg"],
    },
    MealDef {
        name: "Egg and Salad Breakfast",
        description: "Light protein-rich breakfast with fresh salad",
        slug: "breakfast-egg-salad",
        occasion_tags: &["breakfast"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["egg", "salad"],
    },
    // Lunches (3)
    MealDef {
        name: "Chicken Salad Lunch",
        description: "Grilled chicken with fresh salad",
        slug: "lunch-chicken-salad",
        occasion_tags: &["lunch"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["chicken", "salad"],
    },
    MealDef {
        name: "Pasta Lunch",
        description: "Satisfying pasta midday meal",
        slug: "lunch-pasta",
        occasion_tags: &["lunch"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["pasta"],
    },
    MealDef {
        name: "Light Chicken Lunch",
        description: "Simple grilled chicken lunch",
        slug: "lunch-light-chicken",
        occasion_tags: &["lunch"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["chicken"],
    },
    // Dinners (3)
    MealDef {
        name: "Chicken Pasta Dinner",
        description: "Hearty chicken and pasta evening meal",
        slug: "dinner-chicken-pasta",
        occasion_tags: &["dinner"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["chicken", "pasta"],
    },
    MealDef {
        name: "Pasta Dinner",
        description: "Classic pasta evening meal",
        slug: "dinner-pasta",
        occasion_tags: &["dinner"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["pasta"],
    },
    MealDef {
        name: "Salad Dinner",
        description: "Fresh and light salad dinner",
        slug: "dinner-salad",
        occasion_tags: &["dinner"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["salad"],
    },
    // Snacks (2)
    MealDef {
        name: "Oat Energy Snack",
        description: "Quick oat-based energy snack",
        slug: "snack-oat-energy",
        occasion_tags: &["snack"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["porridge"],
    },
    MealDef {
        name: "Light Salad Snack",
        description: "Refreshing light salad snack",
        slug: "snack-light-salad",
        occasion_tags: &["snack"],
        tags: &[AUTO_SEEDED_TAG],
        dish_keywords: &["salad"],
    },
];

/// Insert static catalog meals and link them to already-seeded dishes.
///
/// Idempotent via `ON CONFLICT ON CONSTRAINT uq_meal_external DO NOTHING`.
/// Dish linking is best-effort — skipped silently when a matching dish is absent.
///
/// Returns the number of meals newly inserted (0 on a re-run).
pub async fn insert_meals(tx: &mut PgConnection) -> Result<usize, SeedError> {
    let mut inserted = 0usize;

    for meal in MEALS {
        let meal_id = Uuid::new_v4();
        let occasion_tags: Vec<String> = meal.occasion_tags.iter().map(|s| s.to_string()).collect();
        let tags: Vec<String> = meal.tags.iter().map(|s| s.to_string()).collect();

        let row: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO catalog_meals
                 (meal_id, name, description, occasion_tags, tags, external_source, external_id)
             VALUES ($1, $2, $3, $4, $5, 'plnd_seed', $6)
             ON CONFLICT ON CONSTRAINT uq_meal_external DO NOTHING
             RETURNING meal_id",
        )
        .bind(meal_id)
        .bind(meal.name)
        .bind(meal.description)
        .bind(&occasion_tags)
        .bind(&tags)
        .bind(meal.slug)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(actual_meal_id) = row {
            inserted += 1;
            for keyword in meal.dish_keywords {
                link_dish(&mut *tx, actual_meal_id, keyword).await?;
            }
        }
    }

    Ok(inserted)
}

async fn link_dish(tx: &mut PgConnection, meal_id: Uuid, keyword: &str) -> Result<(), SeedError> {
    let pattern = format!("%{}%", keyword);
    let dish_id: Option<Uuid> =
        sqlx::query_scalar("SELECT dish_id FROM catalog_dishes WHERE name ILIKE $1 LIMIT 1")
            .bind(&pattern)
            .fetch_optional(&mut *tx)
            .await?;

    if let Some(dish_id) = dish_id {
        sqlx::query(
            "INSERT INTO catalog_meal_dishes
                 (meal_dish_id, meal_id, dish_id, dish_servings)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT ON CONSTRAINT uq_meal_dish DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(meal_id)
        .bind(dish_id)
        .execute(&mut *tx)
        .await?;
    }

    Ok(())
}
