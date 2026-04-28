-- H7: Add indexes on hot-path columns
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email);
CREATE INDEX IF NOT EXISTS invitations_expires_at_idx ON invitations (expires_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action_type);
CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs (timestamp);
