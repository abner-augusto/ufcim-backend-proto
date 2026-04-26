ALTER TABLE spaces ADD COLUMN name TEXT NOT NULL DEFAULT '';
UPDATE spaces SET name = number WHERE name = '';
