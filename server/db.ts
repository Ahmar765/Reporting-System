import 'dotenv/config';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
export type Row = Record<string, any>;
export function openDb(path = process.env.DATABASE_PATH || './data/reporting.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), {
    recursive: true
  });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return db;
}
export type DB = ReturnType<typeof openDb>;
export const all = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as Row[];
export const one = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as Row | undefined;
export const exec = (db: DB, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = fn();
    db.exec('COMMIT');
    return v;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export const now = () => new Date().toISOString();
export function audit(db: DB, actor: number | null, action: string, entity: string, id: unknown, before: unknown = null, after: unknown = null) {
  exec(db, 'INSERT INTO audit_logs(actor_id,action,entity,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)', actor, action, entity, String(id), before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), now());
}
export function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
  for (const file of readdirSync(new URL('./migrations/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) {
    const version = Number(file.split('_')[0]);
    if (one(db, 'SELECT version FROM schema_migrations WHERE version=?', version)) continue;
    transaction(db, () => {
      db.exec(readFileSync(new URL('./migrations/' + file, import.meta.url), 'utf8'));
      exec(db, 'INSERT INTO schema_migrations VALUES(?,?)', version, now());
    });
  }
  if (!one(db, 'SELECT id FROM settings')) transaction(db, () => {
    exec(db, 'INSERT INTO settings VALUES(1,?)', JSON.stringify({
      timezone: 'Asia/Karachi',
      deadline: '22:00',
      reminderMinutes: 30,
      weeklyDay: 5,
      weeklyTime: '22:00',
      monthlyDay: 1,
      monthlyTime: '10:00'
    }));
    for (const name of ['Business Development Executive', 'Lead Generation Specialist', 'Outreach Specialist', 'SEO Specialist', 'QA Engineer / Tester', 'Automation Developer', 'Other / Custom Role']) exec(db, 'INSERT INTO roles(name) VALUES(?)', name);
    for (const name of ['LinkedIn', 'Upwork', 'Fiverr', 'Instagram', 'Email Outreach and Follow-ups', 'Website Audits and SEO', 'Automation', 'Other Projects and Tasks']) exec(db, 'INSERT INTO categories(name) VALUES(?)', name);
    exec(db, 'INSERT INTO scoring_configs(user_id,role_id,effective_date,weights,cap,bands,created_at) VALUES(NULL,NULL,?,?,?,?,?)', '2000-01-01', JSON.stringify({
      achievement: 40,
      quality: 25,
      impact: 20,
      consistency: 10,
      learning: 5
    }), 100, JSON.stringify([{
      min: 90,
      label: 'Excellent'
    }, {
      min: 75,
      label: 'Good'
    }, {
      min: 60,
      label: 'Needs Improvement'
    }, {
      min: 0,
      label: 'Below Expectations'
    }]), now());
  });
}
