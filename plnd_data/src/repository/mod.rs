use std::sync::Arc;

pub mod catalog_ingest;
pub mod meal;
pub mod meal_suggestion;
pub mod memory;
pub mod pg;
pub mod preferences;
pub mod schedule;
pub mod session;
pub mod task;
pub mod user;

pub use catalog_ingest::CatalogIngestRepository;
pub use meal::MealRepository;
pub use meal_suggestion::MealSuggestionRepository;
pub use memory::MemoryRepository;
pub use preferences::PreferencesRepository;
pub use schedule::ScheduleRepository;
pub use session::SessionRepository;
pub use task::TaskRepository;
pub use user::UserRepository;

#[derive(Clone)]
pub struct Repositories {
    pub catalog_ingest: Arc<dyn CatalogIngestRepository>,
    pub meal: Arc<dyn MealRepository>,
    pub meal_suggestion: Arc<dyn MealSuggestionRepository>,
    pub memory: Arc<dyn MemoryRepository>,
    pub preferences: Arc<dyn PreferencesRepository>,
    pub schedule: Arc<dyn ScheduleRepository>,
    pub session: Arc<dyn SessionRepository>,
    pub task: Arc<dyn TaskRepository>,
    pub user: Arc<dyn UserRepository>,
}

impl Repositories {
    pub fn from_database(db: &crate::db::Database) -> Self {
        let pool = db.get_pool().clone();
        Self {
            catalog_ingest: Arc::new(pg::catalog_ingest::PgCatalogIngestRepository::new(
                pool.clone(),
            )),
            meal: Arc::new(pg::meal::PgMealRepository::new(pool.clone())),
            meal_suggestion: Arc::new(pg::meal_suggestion::PgMealSuggestionRepository::new(
                pool.clone(),
            )),
            memory: Arc::new(pg::memory::PgMemoryRepository::new(pool.clone())),
            preferences: Arc::new(pg::preferences::PgPreferencesRepository::new(pool.clone())),
            schedule: Arc::new(pg::schedule::PgScheduleRepository::new(pool.clone())),
            session: Arc::new(pg::session::PgSessionRepository::new(pool.clone())),
            task: Arc::new(pg::task::PgTaskRepository::new(pool.clone())),
            user: Arc::new(pg::user::PgUserRepository::new(pool)),
        }
    }
}
