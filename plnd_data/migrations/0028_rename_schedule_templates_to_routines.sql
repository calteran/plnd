ALTER TABLE schedule_templates RENAME TO routines;
ALTER TABLE routines RENAME COLUMN template_id TO routine_id;
ALTER INDEX idx_schedule_templates_user RENAME TO idx_routines_user;
ALTER TABLE routines
    RENAME CONSTRAINT schedule_templates_recurrence_rule_fmt
    TO routines_recurrence_rule_fmt;
ALTER TABLE schedule_entries RENAME COLUMN template_id TO routine_id;
