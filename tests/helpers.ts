import { openDb, migrate, exec, now, type DB, type Row } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
export const TEST_PASSWORD = 'Fixture-only-Passphrase!26';
export async function fixture() {
  const db = openDb(':memory:');
  migrate(db);
  exec(db, 'DELETE FROM kpis');
  const hash = await hashPassword(TEST_PASSWORD);
  for (const [name, email, code, access, role] of [['Fixture Admin', 'admin@example.test', 'TEST-ADMIN', 'admin', 1], ['Fixture Outreach', 'outreach@example.test', 'TEST-001', 'employee', 3], ['Fixture Developer', 'developer@example.test', 'TEST-002', 'employee', 6]]) {
    exec(db, 'INSERT INTO users(name,email,employee_code,access,role_id,password_hash,joining_date,created_at) VALUES(?,?,?,?,?,?,?,?)', name, email, code, access, role, hash, '2026-01-01', now());
  }
  for (const uid of [1, 2, 3]) exec(db, 'INSERT INTO user_categories VALUES(?,?)', uid, uid === 3 ? 7 : 1);
  exec(db, "INSERT INTO kpis(name,description,category_id,unit,kind) VALUES('Qualified outreach','Fixture metric',1,'actions','achievement')");
  exec(db, "INSERT INTO kpis(name,description,category_id,unit,kind) VALUES('Qualified leads','Fixture outcome',1,'leads','impact')");
  exec(db, "INSERT INTO kpis(name,description,category_id,unit,kind) VALUES('Tests passed','Fixture quality',7,'tests','quality')");
  return db;
}
export function assign(db: DB, user = 2, kpi = 1, target = 20, frequency = 'daily', start = '2026-10-01', end: string | null = null) {
  return Number(exec(db, 'INSERT INTO assignments(user_id,kpi_id,target,frequency,start_date,end_date,weight,created_at) VALUES(?,?,?,?,?,?,1,?)', user, kpi, target, frequency, start, end, now()).lastInsertRowid);
}
export const reportBody = (date: string, assignment_id: number | null = null) => ({
  date,
  version: 0,
  achievements: 'Fixture: completed qualified outreach',
  blockers: '',
  missed_reason: '',
  lessons: 'Better qualification',
  suggestions: '',
  next_plan: 'Follow up with qualified prospects',
  assistance: '',
  submit: false,
  activities: [{
    category_id: 1,
    assignment_id,
    title: 'Qualified outreach',
    description: 'Fixture only',
    actual: 18,
    unit: 'actions',
    outcome: 'Qualified conversations',
    status: 'completed',
    minutes: 60,
    evidence: 'https://example.test/task',
    notes: ''
  }]
});
export function insertReport(db: DB, user: number, date: string, entries: Row[], submitted_at = date + 'T16:00:00.000Z') {
  const rid = Number(exec(db, "INSERT INTO reports(user_id,date,status,created_at,updated_at,submitted_at) VALUES(?,?,'submitted',?,?,?)", user, date, submitted_at, submitted_at, submitted_at).lastInsertRowid);
  for (const a of entries) exec(db, "INSERT INTO activities(report_id,category_id,assignment_id,title,description,actual,unit,outcome,status) VALUES(?,?,?,?,?,?,?,?,'completed')", rid, a.category_id || 1, a.assignment_id || null, a.title || 'Fixture activity', '', a.actual, a.unit || 'actions', '');
  return rid;
}
