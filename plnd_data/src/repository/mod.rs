use std::sync::Arc;

pub mod meal;
pub mod memory;
pub mod pg;
pub mod preferences;
pub mod schedule;
pub mod session;
pub mod task;
pub mod user;

pub use meal::MealRepository;
pub use memory::MemoryRepository;
pub use preferences::PreferencesRepository;
pub use schedule::ScheduleRepository;
pub use session::SessionRepository;
pub use task::TaskRepository;
pub use user::UserRepository;

#[derive(Clone)]
pub struct Repositories {
    pub meal: Arc<dyn MealRepository>,
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
            meal: Arc::new(pg::meal::PgMealRepository::new(pool.clone())),
            memory: Arc::new(pg::memory::PgMemoryRepository::new(pool.clone())),
            preferences: Arc::new(pg::preferences::PgPreferencesRepository::new(pool.clone())),
            schedule: Arc::new(pg::schedule::PgScheduleRepository::new(pool.clone())),
            session: Arc::new(pg::session::PgSessionRepository::new(pool.clone())),
            task: Arc::new(pg::task::PgTaskRepository::new(pool.clone())),
            user: Arc::new(pg::user::PgUserRepository::new(pool)),
        }
    }
}
