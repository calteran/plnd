-- Migration 0011: Exercises, families, tasks, and scheduling.
-- Consolidates the full task/schedule domain model.

-- ---------------------------------------------------------------------------
-- Exercise catalog
-- ---------------------------------------------------------------------------
CREATE TABLE catalog_exercises (
    exercise_id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(200) NOT NULL,
    description            TEXT,
    default_duration_minutes INTEGER    CHECK (default_duration_minutes >= 0),
    intensity              VARCHAR(20)  NOT NULL CHECK (intensity IN ('low', 'moderate', 'high')),
    muscle_groups          TEXT[]       NOT NULL DEFAULT '{}',
    equipment_required     TEXT[]       NOT NULL DEFAULT '{}',
    tags                   TEXT[]       NOT NULL DEFAULT '{}',
    external_id            VARCHAR(100),
    external_source        VARCHAR(50),            -- 'wger' | NULL
    contributed_by_user_id UUID         REFERENCES users(user_id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_exercise_external UNIQUE (external_source, external_id)
);

CREATE INDEX idx_catalog_exercises_fts ON catalog_exercises
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- ---------------------------------------------------------------------------
-- User exercise library
-- ---------------------------------------------------------------------------
CREATE TABLE user_exercises (
    user_exercise_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    catalog_exercise_id      UUID         REFERENCES catalog_exercises(exercise_id) ON DELETE SET NULL,
    name                     VARCHAR(200) NOT NULL,
    description              TEXT,
    default_duration_minutes INTEGER      CHECK (default_duration_minutes >= 0),
    intensity                VARCHAR(20)  NOT NULL CHECK (intensity IN ('low', 'moderate', 'high')),
    muscle_groups            TEXT[]       NOT NULL DEFAULT '{}',
    equipment_required       TEXT[]       NOT NULL DEFAULT '{}',
    tags                     TEXT[]       NOT NULL DEFAULT '{}',
    rating                   SMALLINT     CHECK (rating BETWEEN 1 AND 5),
    is_blocked               BOOLEAN      NOT NULL DEFAULT FALSE,
    notes                    TEXT,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_exercises_user    ON user_exercises (user_id);
CREATE INDEX idx_user_exercises_catalog ON user_exercises (catalog_exercise_id) WHERE catalog_exercise_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Family coordination
-- ---------------------------------------------------------------------------
CREATE TABLE families (
    family_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE family_members (
    family_member_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id        UUID        NOT NULL REFERENCES families(family_id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role             VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'member', 'caregiver')),
    can_plan_for     UUID[]      NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_family_member UNIQUE (family_id, user_id)
);

CREATE TABLE family_meals (
    family_meal_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id           UUID         NOT NULL REFERENCES families(family_id) ON DELETE CASCADE,
    planned_by_user_id  UUID         NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    date                DATE         NOT NULL,
    time_window_start   TIME,
    time_window_end     TIME,
    user_meal_id        UUID         REFERENCES user_meals(user_meal_id) ON DELETE SET NULL,
    title               VARCHAR(200) NOT NULL,
    notes               TEXT,
    participants        UUID[]       NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_family_meals_family ON family_meals (family_id, date);

-- ---------------------------------------------------------------------------
-- Tasks (universal scheduling unit)
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
    task_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title            VARCHAR(200) NOT NULL,
    task_type        VARCHAR(20)  NOT NULL CHECK (task_type IN ('meal', 'exercise', 'work', 'leisure', 'appointment', 'medication', 'custom')),
    scheduled_start  TIMESTAMPTZ,
    duration_minutes INTEGER      CHECK (duration_minutes >= 0),
    energy_required  VARCHAR(10)  NOT NULL DEFAULT 'medium' CHECK (energy_required IN ('low', 'medium', 'high')),
    status           VARCHAR(20)  NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped', 'deferred')),
    is_milepost      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_user        ON tasks (user_id);
CREATE INDEX idx_tasks_user_start  ON tasks (user_id, scheduled_start);
CREATE INDEX idx_tasks_type        ON tasks (task_type);

-- ---------------------------------------------------------------------------
-- Task specialization tables (joined on demand by task_type)
-- ---------------------------------------------------------------------------

-- meal_tasks: schedule a full user_meal OR a single user_dish directly
CREATE TABLE meal_tasks (
    task_id        UUID NOT NULL PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_meal_id   UUID REFERENCES user_meals(user_meal_id) ON DELETE SET NULL,
    user_dish_id   UUID REFERENCES user_dishes(user_dish_id) ON DELETE SET NULL,
    family_meal_id UUID REFERENCES family_meals(family_meal_id) ON DELETE SET NULL,
    occasion_label TEXT,           -- free-form eating occasion label, e.g. "breakfast", "late snack"
    -- At most one food source (meal or dish, not both)
    CONSTRAINT chk_meal_task_at_most_one_food CHECK (
        NOT (user_meal_id IS NOT NULL AND user_dish_id IS NOT NULL)
    )
);

CREATE TABLE exercise_tasks (
    task_id          UUID NOT NULL PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_exercise_id UUID REFERENCES user_exercises(user_exercise_id) ON DELETE SET NULL,
    intensity        VARCHAR(20) CHECK (intensity IN ('low', 'moderate', 'high')),
    muscle_groups    TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE work_tasks (
    task_id              UUID NOT NULL PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
    project_label        TEXT,
    focus_level_required VARCHAR(10) CHECK (focus_level_required IN ('low', 'medium', 'deep'))
);

CREATE TABLE generic_tasks (
    task_id  UUID NOT NULL PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
    category TEXT,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high'))
);

-- ---------------------------------------------------------------------------
-- Schedule templates (recurring patterns — not pre-materialized)
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_templates (
    template_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    task_type         VARCHAR(20)  NOT NULL CHECK (task_type IN ('meal', 'exercise', 'work', 'leisure', 'appointment', 'medication', 'custom')),
    title             VARCHAR(200) NOT NULL,
    recurrence        VARCHAR(20)  NOT NULL CHECK (recurrence IN ('daily', 'weekdays', 'weekly', 'custom')),
    recurrence_rule   TEXT,        -- RRULE string for custom recurrence patterns
    time_window_start TIME,
    time_window_end   TIME,
    duration_minutes  INTEGER      CHECK (duration_minutes >= 0),
    energy_required   VARCHAR(10)  NOT NULL DEFAULT 'medium' CHECK (energy_required IN ('low', 'medium', 'high')),
    is_milepost       BOOLEAN      NOT NULL DEFAULT FALSE,
    task_ref_id       UUID,        -- polymorphic ref to catalog/user table
    task_ref_type     VARCHAR(30), -- discriminator: 'user_meal' | 'user_dish' | 'user_exercise' | ...
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedule_templates_user ON schedule_templates (user_id);

-- ---------------------------------------------------------------------------
-- Schedule entries (concrete instances for a specific date)
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_entries (
    entry_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    template_id     UUID         REFERENCES schedule_templates(template_id) ON DELETE SET NULL,
    task_type       VARCHAR(20)  NOT NULL CHECK (task_type IN ('meal', 'exercise', 'work', 'leisure', 'appointment', 'medication', 'custom')),
    task_ref_id     UUID,        -- polymorphic ref to catalog/user table
    task_ref_type   VARCHAR(30), -- discriminator: 'user_meal' | 'user_dish' | 'user_exercise' | ...
    date            DATE         NOT NULL,
    scheduled_start TIMESTAMPTZ  NOT NULL,
    scheduled_end   TIMESTAMPTZ,
    status          VARCHAR(20)  NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped', 'deferred')),
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    family_meal_id  UUID         REFERENCES family_meals(family_meal_id) ON DELETE SET NULL,
    after_milepost  VARCHAR(10)  CHECK (after_milepost IN ('breakfast', 'lunch', 'dinner')),
    after_entry_id  UUID         REFERENCES schedule_entries(entry_id) ON DELETE SET NULL,
    deviation_note  TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedule_entries_user_date ON schedule_entries (user_id, date);
CREATE INDEX idx_schedule_entries_template  ON schedule_entries (template_id) WHERE template_id IS NOT NULL;
