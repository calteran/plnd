use std::sync::Arc;

pub mod meal;
pub mod memory;
pub mod pg;
pub mod preferences;
pub mod schedule;
pub mod task;

pub use meal::MealRepository;
pub use memory::MemoryRepository;
pub use preferences::PreferencesRepository;
pub use schedule::ScheduleRepository;
pub use task::TaskRepository;

#[derive(Clone)]
pub struct Repositories {
    pub meal: Arc<dyn MealRepository>,
    pub memory: Arc<dyn MemoryRepository>,
    pub preferences: Arc<dyn PreferencesRepository>,
    pub schedule: Arc<dyn ScheduleRepository>,
    pub task: Arc<dyn TaskRepository>,
}

impl Repositories {
    pub fn from_database(db: &crate::db::Database) -> Self {
        let pool = db.get_pool().clone();
        Self {
            meal: Arc::new(pg::meal::PgMealRepository::new(pool.clone())),
            memory: Arc::new(pg::memory::PgMemoryRepository::new(pool.clone())),
            preferences: Arc::new(pg::preferences::PgPreferencesRepository::new(pool.clone())),
            schedule: Arc::new(pg::schedule::PgScheduleRepository::new(pool.clone())),
            task: Arc::new(pg::task::PgTaskRepository::new(pool)),
        }
    }
}
