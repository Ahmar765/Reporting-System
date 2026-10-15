import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { all, one, type Row } from '../../shared/query';
export { all, one };
const migrations = import.meta.glob('../../server/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
let engine: Promise<SqlJsStatic> | undefined;
export function initializeProjectionEngine(sql: SqlJsStatic) { engine = Promise.resolve(sql); }
export class DB {
  constructor(readonly sqlite: Database) {}
  exec(sql: string) { this.sqlite.run(sql); }
  prepare(sql: string) {
    const rows = (...params: any[]) => {
      const statement = this.sqlite.prepare(sql);
      try { statement.bind(params); const values: Row[] = []; while (statement.step()) values.push(statement.getAsObject()); return values; }
      finally { statement.free(); }
    };
    return {
      all: rows,
      get: (...params: any[]) => rows(...params)[0],
      run: (...params: any[]) => {
        let statement = sql;
        // A deterministic per-user/date key avoids ID collisions between isolated employee views.
        if (sql.startsWith('INSERT INTO reports(user_id,date,')) {
          statement = sql.replace('reports(user_id,date,', 'reports(id,user_id,date,').replace('VALUES(', 'VALUES(?,');
          params.unshift(Number(params[0]) * 100_000_000 + Number(String(params[1]).replaceAll('-', '')));
        }
        this.sqlite.run(statement, params);
        return { lastInsertRowid: Number(this.sqlite.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] || 0), changes: this.sqlite.getRowsModified() };
      }
    };
  }
  close() { this.sqlite.close(); }
}
export const exec = (db: DB, sql: string, ...params: any[]) => db.prepare(sql).run(...params);
export const now = () => new Date().toISOString();
export function transaction<T>(db: DB, fn: () => T) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function audit(db: DB, actor: number | null, action: string, entity: string, id: unknown, before: unknown = null, after: unknown = null) {
  exec(db, 'INSERT INTO audit_logs(actor_id,action,entity,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)', actor, action, entity, String(id), before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), now());
}
export async function openProjection() {
  engine ||= initSqlJs({ locateFile: () => wasmUrl });
  const db = new DB(new (await engine).Database());
  for (const name of Object.keys(migrations).sort()) db.exec(migrations[name]);
  return db;
}
export function insertRows(db: DB, table: string, rows: Row[]) {
  for (const row of rows) {
    const keys = Object.keys(row);
    exec(db, `INSERT OR IGNORE INTO "${table}" (${keys.map(k => `"${k}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map(k => row[k]));
  }
}
