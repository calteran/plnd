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

pub const VALID_FAMILY_ROLES: &[&str] = &["owner", "member", "caregiver"];

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

/// Soft eating occasion labels for meal anchor entries — not DB-validated; used for UI autocomplete.
pub const SUGGESTED_OCCASION_LABELS: &[&str] = &[
    "breakfast",
    "morning snack",
    "lunch",
    "afternoon snack",
    "dinner",
    "late snack",
    "post-workout",
];
