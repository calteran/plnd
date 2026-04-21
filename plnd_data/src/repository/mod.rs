use std::sync::Arc;

pub mod briefing;
pub mod catalog_ingest;
pub mod exercise;
pub mod meal;
pub mod meal_search;
pub mod meal_suggestion;
pub mod memory;
pub mod pg;
pub mod preferences;
pub mod schedule;
pub mod session;
pub mod task;
pub mod user;
pub mod user_dish_prefs;
pub mod user_ingredient_pref;
pub mod user_meal_pref;

pub use crate::db::error::DatabaseError;
pub use briefing::BriefingRepository;
pub use catalog_ingest::CatalogIngestRepository;
pub use exercise::ExerciseRepository;
pub use meal::MealRepository;
pub use meal_search::MealSearchRepository;
pub use meal_suggestion::MealSuggestionRepository;
pub use memory::MemoryRepository;
pub use preferences::PreferencesRepository;
pub use schedule::ScheduleRepository;
pub use session::SessionRepository;
pub use task::TaskRepository;
pub use user::UserRepository;
pub use user_dish_prefs::{AddIngredientParams, UserDishPrefRepository};
pub use user_ingredient_pref::UserIngredientPrefRepository;
pub use user_meal_pref::UserMealPrefRepository;

pub use crate::db::models::{LocalDishResult, LocalExerciseResult, LocalIngredientResult};

#[derive(Clone)]
pub struct Repositories {
    pub briefing: Arc<dyn BriefingRepository>,
    pub catalog_ingest: Arc<dyn CatalogIngestRepository>,
    pub exercise: Arc<dyn ExerciseRepository>,
    pub meal: Arc<dyn MealRepository>,
    pub meal_search: Arc<dyn MealSearchRepository>,
    pub meal_suggestion: Arc<dyn MealSuggestionRepository>,
    pub memory: Arc<dyn MemoryRepository>,
    pub preferences: Arc<dyn PreferencesRepository>,
    pub schedule: Arc<dyn ScheduleRepository>,
    pub session: Arc<dyn SessionRepository>,
    pub task: Arc<dyn TaskRepository>,
    pub user: Arc<dyn UserRepository>,
    pub user_dish_prefs: Arc<dyn UserDishPrefRepository>,
    pub user_ingredient_pref: Arc<dyn UserIngredientPrefRepository>,
    pub user_meal_pref: Arc<dyn UserMealPrefRepository>,
}

impl Repositories {
    pub fn from_database(db: &crate::db::Database) -> Self {
        let pool = db.get_pool().clone();
        Self {
            briefing: Arc::new(pg::briefing::PgBriefingRepository::new(pool.clone())),
            catalog_ingest: Arc::new(pg::catalog_ingest::PgCatalogIngestRepository::new(
                pool.clone(),
            )),
            exercise: Arc::new(pg::exercise::PgExerciseRepository::new(pool.clone())),
            meal: Arc::new(pg::meal::PgMealRepository::new(pool.clone())),
            meal_search: Arc::new(pg::meal_search::PgMealSearchRepository::new(pool.clone())),
            meal_suggestion: Arc::new(pg::meal_suggestion::PgMealSuggestionRepository::new(
                pool.clone(),
            )),
            memory: Arc::new(pg::memory::PgMemoryRepository::new(pool.clone())),
            preferences: Arc::new(pg::preferences::PgPreferencesRepository::new(pool.clone())),
            schedule: Arc::new(pg::schedule::PgScheduleRepository::new(pool.clone())),
            session: Arc::new(pg::session::PgSessionRepository::new(pool.clone())),
            task: Arc::new(pg::task::PgTaskRepository::new(pool.clone())),
            user: Arc::new(pg::user::PgUserRepository::new(pool.clone())),
            user_dish_prefs: Arc::new(pg::user_dish_prefs::PgUserDishPrefRepository::new(
                pool.clone(),
            )),
            user_ingredient_pref: Arc::new(
                pg::user_ingredient_pref::PgUserIngredientPrefRepository::new(pool.clone()),
            ),
            user_meal_pref: Arc::new(pg::user_meal_pref::PgUserMealPrefRepository::new(pool)),
        }
    }
}
