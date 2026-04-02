CREATE TABLE user_preferences (
    user_id     UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    theme       VARCHAR(20) NOT NULL DEFAULT 'system'
                    CHECK (theme IN ('system', 'light', 'dark')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('0003_user_preferences');
