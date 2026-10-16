ALTER TABLE reports ADD COLUMN employee_edit_count INTEGER NOT NULL DEFAULT 0 CHECK (employee_edit_count BETWEEN 0 AND 1);
ALTER TABLE reports ADD COLUMN employee_edit_open INTEGER NOT NULL DEFAULT 0 CHECK (employee_edit_open IN (0,1));
