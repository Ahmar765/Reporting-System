-- Retain historical ownership and audit references when an employee leaves.
ALTER TABLE users ADD COLUMN deleted_at TEXT CHECK (deleted_at IS NULL OR (active=0 AND access='employee'));
