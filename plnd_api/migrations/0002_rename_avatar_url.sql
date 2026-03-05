ALTER TABLE users RENAME COLUMN profile_picture_url TO avatar_url;
INSERT INTO schema_migrations (version) VALUES ('0002_rename_avatar_url');
