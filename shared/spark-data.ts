import { all, type ReadDB, type Row } from './query.js';

export const CONFIG_TABLES = ['roles', 'categories', 'kpis', 'settings', 'scoring_configs', 'holidays'];
export const PROFILE_TABLES = ['assignments', 'leave_days', 'profile_versions', 'reflections', 'overrides'];
export type SparkConfig = { revision: number; tables: Record<string, Row[]>; reviewers: Row[] };
export type SparkProfile = { revision: number; uid: string; row: Row; category_ids: number[]; tables: Record<string, Row[]> };
export type SparkReport = { revision: number; owner: number; ownerUid: string; report: Row; activities: Row[]; files: Record<string, Row>; feedback: Row[] };
export const reportKey = (r: Row) => `${r.user_id}_${r.date}`;
export function safeUser(row: Row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['password_hash', 'role_name', 'csrf', 'token_hash', 'expires_at'].includes(key)));
}
export function captureConfig(db: ReadDB, revision = 0): SparkConfig {
  return { revision, tables: Object.fromEntries(CONFIG_TABLES.map(t => [t, all(db, `SELECT * FROM ${t} ORDER BY id`)])), reviewers: all(db, "SELECT id,name,role_id FROM users WHERE access='admin' ORDER BY id") };
}
export function captureProfile(db: ReadDB, user: Row, uid: string, revision = 0): SparkProfile {
  return {
    revision, uid, row: safeUser(user),
    category_ids: all(db, 'SELECT category_id FROM user_categories WHERE user_id=? ORDER BY category_id', user.id).map(r => r.category_id),
    tables: Object.fromEntries(PROFILE_TABLES.map(t => [t, all(db, `SELECT * FROM ${t} WHERE user_id=? ORDER BY id`, user.id).map(row => t === 'reflections' ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id')) : row)]))
  };
}
export function captureReport(db: ReadDB, report: Row, ownerUid: string, revision = 0): SparkReport {
  return {
    revision, owner: report.user_id, ownerUid, report,
    activities: all(db, 'SELECT * FROM activities WHERE report_id=? ORDER BY id', report.id).map(a => ({
      ...Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'id')),
      links: all(db, 'SELECT url FROM activity_links WHERE activity_id=? ORDER BY id', a.id).map(l => l.url)
    })),
    files: Object.fromEntries(all(db, 'SELECT * FROM report_files WHERE report_id=? ORDER BY id', report.id).map(f => [f.id, f])),
    feedback: all(db, 'SELECT * FROM feedback WHERE report_id=? ORDER BY id', report.id).map(f => Object.fromEntries(Object.entries(f).filter(([key]) => key !== 'id')))
  };
}
export function sameData(a: unknown, b: unknown): boolean {
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !['revision', 'changedAt', 'actorUid', 'createdAt', 'firstSubmittedAt', 'submittedAt', 'created_at', 'updated_at', 'submitted_at', 'first_submitted_at'].includes(k)).sort().map(k => [k, stable(v[k])])) : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export function checkDocumentSize(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 800 * 1024) throw Error('This record is too large. Shorten the text or split the uploaded data into smaller files.');
}
