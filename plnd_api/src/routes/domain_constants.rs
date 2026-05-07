// Domain validation constants for the task/schedule model.
// DB-enforced values (used in CHECK constraints) live here so route handlers and tests can import them.
// Occasion tags/labels are suggestions only — NOT DB-enforced; used for UI autocomplete.

pub const VALID_TASK_TYPES: &[&str] = &[
    "exercise",
    "work",
    "leisure",
    "appointment",
    "medication",
    "general",
];

pub const VALID_ENERGY_LEVELS: &[&str] = &["low", "medium", "high"];

pub const VALID_TASK_STATUSES: &[&str] =
    &["planned", "in_progress", "completed", "skipped", "deferred"];

pub const VALID_INTENSITY_LEVELS: &[&str] = &["low", "moderate", "high"];

pub const VALID_FOCUS_LEVELS: &[&str] = &["low", "medium", "deep"];

pub const VALID_PRIORITY_LEVELS: &[&str] = &["low", "normal", "high"];

pub const VALID_RECURRENCE_TYPES: &[&str] = &["daily", "weekdays", "weekly", "monthly", "yearly"];

/// Soft occasion hints for dishes and meals — not DB-validated; used for UI autocomplete.
pub const SUGGESTED_OCCASION_TAGS: &[&str] = &[
    "breakfast-friendly",
    "lunch",
    "dinner",
    "snack",
    "quick",
    "light",
    "hearty",
    "comfort",
    "weekend",
    "festive",
    "post-workout",
    "meal-prep",
];

/// Suggested meal names for the user's meal pattern — not DB-validated; used for UI autocomplete.
pub const SUGGESTED_MEAL_NAMES: &[&str] = &[
    "breakfast",
    "morning snack",
    "lunch",
    "afternoon snack",
    "dinner",
    "late snack",
    "post-workout",
];
