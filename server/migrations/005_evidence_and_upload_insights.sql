CREATE TABLE activity_links (id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE, url TEXT NOT NULL CHECK(length(url)<=2048), created_at TEXT NOT NULL);
CREATE INDEX activity_links_activity ON activity_links(activity_id);
CREATE TABLE report_files (id TEXT PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), original_name TEXT NOT NULL CHECK(length(original_name)<=255), extension TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880), storage_name TEXT NOT NULL UNIQUE, sheet_name TEXT NOT NULL DEFAULT '', columns_json TEXT NOT NULL DEFAULT '[]', row_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX report_files_report ON report_files(report_id,created_at);
CREATE INDEX report_files_user ON report_files(user_id,created_at);
CREATE TABLE report_file_rows (id INTEGER PRIMARY KEY, file_id TEXT NOT NULL REFERENCES report_files(id) ON DELETE CASCADE, row_number INTEGER NOT NULL, values_json TEXT NOT NULL, UNIQUE(file_id,row_number));
CREATE INDEX report_file_rows_file ON report_file_rows(file_id,row_number);
