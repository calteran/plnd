CREATE TABLE dietary_restrictions (
    restriction_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    restriction_type VARCHAR(20)  NOT NULL
                         CHECK (restriction_type IN ('allergy', 'intolerance', 'preference')),
    name             VARCHAR(100) NOT NULL,
    notes            TEXT
                         CHECK (char_length(notes) <= 500),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_type_name UNIQUE (user_id, restriction_type, name)
);

INSERT INTO schema_migrations (version) VALUES ('0004_dietary_restrictions');
