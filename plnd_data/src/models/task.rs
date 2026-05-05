use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Tasks (universal scheduling unit — base entity)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Task {
    pub task_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub task_type: String, // 'meal' | 'exercise' | 'work' | 'leisure' | 'appointment' | 'medication' | 'general'
    pub scheduled_start: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub energy_required: String, // 'low' | 'medium' | 'high'
    pub status: String,          // 'planned' | 'in_progress' | 'completed' | 'skipped' | 'deferred'
    pub is_anchor: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Task specialization tables (joined on demand by task_type)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MealTask {
    pub task_id: Uuid,
    pub user_meal_id: Option<Uuid>,
    pub user_dish_id: Option<Uuid>, // schedule a single dish without a meal wrapper
    pub family_meal_id: Option<Uuid>,
    pub occasion_label: Option<String>, // free-form: "breakfast", "morning snack", etc.
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ExerciseTask {
    pub task_id: Uuid,
    pub user_exercise_id: Option<Uuid>,
    pub intensity: Option<String>,
    pub muscle_groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkTask {
    pub task_id: Uuid,
    pub project_label: Option<String>,
    pub focus_level_required: Option<String>, // 'low' | 'medium' | 'deep'
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GenericTask {
    pub task_id: Uuid,
    pub category: Option<String>,
    pub priority: String, // 'low' | 'normal' | 'high'
}
