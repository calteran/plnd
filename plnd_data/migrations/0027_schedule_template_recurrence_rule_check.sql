ALTER TABLE schedule_templates
    ADD CONSTRAINT schedule_templates_recurrence_rule_fmt
    CHECK (recurrence_rule IS NULL OR recurrence_rule LIKE 'FREQ=%');
