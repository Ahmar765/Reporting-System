import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { all, migrate, openDb, type DB, type Row } from './db.js';

export const RECORDS = 'cadenceRecords';
export const STATE = 'cadenceSystem/state';
const CHUNK_BYTES = 256 * 1024;
const MAX_COMMIT_BYTES = 7 * 1024 * 1024;

export class PersistenceError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export function schemaVersion() {
  const files = readdirSync(new URL('./migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(new URL('./migrations/' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
  return hash.digest('hex');
}

function tableNames(db: DB): string[] {
  return all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").map(r => r.name);
}

/** Firestore is authoritative. SQLite exists only in RAM for the established SQL rules and analytics. */
export function captureRecords(db: DB): Map<string, DocumentData> {
  const documents = new Map<string, DocumentData>();
  for (const table of tableNames(db)) {
    const keys = all(db, 'PRAGMA table_info("' + table + '")').filter(r => r.pk).sort((a, b) => a.pk - b.pk).map(r => r.name);
    const groups = new Map<string, Row[]>();
    for (const row of all(db, 'SELECT * FROM "' + table + '" ORDER BY ' + keys.map(k => '"' + k + '"').join(','))) {
      // Imported spreadsheets use bounded pages rather than 10,000 individual writes.
      const key = table === 'report_file_rows' ? String(Math.floor((row.id - 1) / 50)) : JSON.stringify(keys.map(k => row[k]));
      const rows = groups.get(key) || [];
      rows.push(row);
      groups.set(key, rows);
    }
    for (const [key, rows] of groups) {
      const id = table + '_' + createHash('sha256').update(key).digest('hex');
      const data = Buffer.from(JSON.stringify(rows));
      if (rows.length === 1 && data.length <= CHUNK_BYTES) {
        documents.set(id, { table, row: rows[0] });
      } else {
        const parts = Math.ceil(data.length / CHUNK_BYTES);
        for (let part = 0; part < parts; part++) documents.set(id + '_' + part, {
          table, group: id, part, parts, payload: data.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES)
        });
      }
    }
  }
  return documents;
}

export function restoreRecords(db: DB, documents: Map<string, DocumentData>) {
  const names = new Set(tableNames(db));
  const rows = new Map<string, Row[]>();
  const groups = new Map<string, DocumentData[]>();
  for (const document of documents.values()) {
    if (!names.has(document.table)) throw new PersistenceError('Unknown stored table. A database migration is required.');
    if (document.row) {
      const list = rows.get(document.table) || [];
      list.push(document.row);
      rows.set(document.table, list);
    } else {
      const list = groups.get(document.group) || [];
      list.push(document);
      groups.set(document.group, list);
    }
  }
  for (const parts of groups.values()) {
    parts.sort((a, b) => a.part - b.part);
    if (parts.length !== parts[0].parts || parts.some((p, i) => p.part !== i || p.parts !== parts.length || p.table !== parts[0].table)) throw new PersistenceError('Stored data page is incomplete.');
    const values = JSON.parse(Buffer.concat(parts.map(p => Buffer.from(p.payload))).toString('utf8')) as Row[];
    rows.set(parts[0].table, [...(rows.get(parts[0].table) || []), ...values]);
  }
  db.exec('PRAGMA foreign_keys=OFF; BEGIN');
  try {
    // Only fresh in-memory databases may be hydrated (audit history is immutable).
    if (all(db, 'SELECT id FROM audit_logs LIMIT 1').length) throw new PersistenceError('Cannot hydrate a database that is already in use.');
    for (const table of names) db.exec('DELETE FROM "' + table + '"');
    for (const [table, records] of rows) {
      const columns = new Set(all(db, 'PRAGMA table_info("' + table + '")').map(r => r.name));
      for (const row of records) {
        const keys = Object.keys(row);
        if (keys.some(k => !columns.has(k))) throw new PersistenceError('Stored schema does not match this release.');
        db.prepare('INSERT INTO "' + table + '" (' + keys.map(k => '"' + k + '"').join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k]));
      }
    }
    if (all(db, 'PRAGMA foreign_key_check').length) throw new PersistenceError('Stored data has invalid relationships.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

function fingerprint(data: DocumentData): string {
  const stable = (value: any): any => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('base64') };
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  return JSON.stringify(stable(data));
}

export class FirestoreDatabase {
  private cachedRecords?: Map<string, DocumentData>;
  private cachedRevision = -1;
  constructor(private firestore: Firestore) {}

  async ready() {
    return (await this.firestore.doc(STATE).get()).exists;
  }

  async run<T>(operation: (db: DB) => Promise<T> | T): Promise<T> {
    const committed = await this.firestore.runTransaction(async tx => {
      // Every reader/writer locks the same metadata document for a coherent snapshot.
      // No handler is retried: uploads and email side effects must never be replayed.
      const stateRef = this.firestore.doc(STATE);
      const state = await tx.get(stateRef);
      if (state.exists && state.get('schema') !== schemaVersion()) throw new PersistenceError('A cloud database schema upgrade is required.');
      const revision = Number(state.get('revision') || 0);
      let before: Map<string, DocumentData>;
      if (state.exists && this.cachedRecords && this.cachedRevision === revision) {
        before = this.cachedRecords;
      } else {
        const snapshot = await tx.get(this.firestore.collection(RECORDS));
        if (!state.exists && !snapshot.empty) throw new PersistenceError('Cloud database metadata is missing.');
        before = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
      }
      const db = openDb(':memory:');
      try {
        migrate(db);
        if (state.exists) restoreRecords(db, before);
        const result = await operation(db);
        const after = captureRecords(db);
        const changed = [...after].filter(([key, value]) => !before.has(key) || fingerprint(before.get(key)!) !== fingerprint(value));
        const deleted = [...before.keys()].filter(key => !after.has(key));
        const bytes = changed.reduce((sum, [, value]) => sum + Buffer.byteLength(fingerprint(value)), 0);
        if (bytes > MAX_COMMIT_BYTES || changed.length + deleted.length > 450) throw new PersistenceError('This change exceeds the safe cloud transaction size. Split the upload into smaller files.', 413);
        for (const [key, value] of changed) tx.set(this.firestore.collection(RECORDS).doc(key), value);
        for (const key of deleted) tx.delete(this.firestore.collection(RECORDS).doc(key));
        const nextRevision = revision + ((!state.exists || changed.length || deleted.length) ? 1 : 0);
        if (!state.exists || changed.length || deleted.length) tx.set(stateRef, {
          schema: schemaVersion(), revision: nextRevision, updatedAt: new Date().toISOString()
        });
        return { result, records: after, revision: nextRevision };
      } finally {
        db.close();
      }
    }, { maxAttempts: 1 });
    // Publish a cache only after the remote transaction has actually committed.
    if (committed.revision >= this.cachedRevision) {
      this.cachedRevision = committed.revision;
      this.cachedRecords = committed.records;
    }
    return committed.result;
  }
}
