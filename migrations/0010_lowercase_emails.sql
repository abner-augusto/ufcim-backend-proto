-- Lowercase any existing user emails (handles mixed-case rows from before this fix).
UPDATE users SET email = lower(email) WHERE email != lower(email);
UPDATE invitations SET email = lower(email) WHERE email != lower(email);
