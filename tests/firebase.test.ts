import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { openDb, migrate, all, one, exec } from '../server/db.js';
import { captureRecords, restoreRecords, FirestoreDatabase, RECORDS, STATE } from '../server/firestore-store.js';
import { createHostedApp } from '../server/hosted-app.js';
import { fixture, TEST_PASSWORD, reportBody } from './helpers.js';
import type { StagedAttachments } from '../server/firestore-attachments.js';
import type { AddressInfo } from 'node:net';

class MemoryFirestore {
  documents = new Map<string, DocumentData>();
  scans = 0;
  failCommit = false;
  doc(path: string) { return { path, id: path.split('/').pop(), get: async () => this.snapshot(path) }; }
  collection(path: string) { return { path, collection: true, doc: (id: string) => this.doc(path + '/' + id) }; }
  snapshot(path: string) {
    const data = this.documents.get(path);
    return { exists: data !== undefined, get: (key: string) => data?.[key], id: path.split('/').pop()!, data: () => data! };
  }
  async runTransaction<T>(callback: (tx: any) => Promise<T>, options: { maxAttempts: number }) {
    assert.equal(options.maxAttempts, 1, 'HTTP handlers must never be replayed');
    const changes = new Map<string, DocumentData | null>();
    const result = await callback({
      get: async (ref: any) => {
        if (!ref.collection) return this.snapshot(ref.path);
        this.scans++;
        const docs = [...this.documents.keys()].filter(path => path.startsWith(ref.path + '/')).map(path => this.snapshot(path));
        return { docs, empty: !docs.length };
      },
      set: (ref: any, value: DocumentData) => changes.set(ref.path, value),
      delete: (ref: any) => changes.set(ref.path, null)
    });
    if (this.failCommit) throw Object.assign(Error('Simulated conflict'), { code: 10 });
    for (const [path, data] of changes) {
      if (data === null) this.documents.delete(path); else this.documents.set(path, data);
    }
    return result;
  }
  asFirestore() { return this as unknown as Firestore; }
}

function memoryAttachments(shared = new Map<string, Buffer>()): StagedAttachments {
  const added = new Map<string, Buffer>();
  const removed = new Set<string>();
  return {
    async put(name, bytes) { added.set(name, bytes); },
    async get(name) { return shared.get(name)!; },
    async remove(name) { added.delete(name); removed.add(name); },
    async prepare() { for (const [name, bytes] of added) shared.set(name, bytes); },
    async rollback() { for (const name of added.keys()) shared.delete(name); },
    async finish() { for (const name of removed) shared.delete(name); }
  };
}

test('Firestore documents restore constraints, audit history and large UTF-8 data pages', async () => {
  const source = await fixture();
  const target = openDb(':memory:');
  migrate(target);
  try {
    exec(source, 'INSERT INTO audit_logs(actor_id,action,entity,entity_id,after_json,created_at) VALUES(1,?,?,?,?,?)', 'fixture', 'fixture', '1', JSON.stringify({ text: 'اردو🚀'.repeat(50000) }), new Date().toISOString());
    const records = captureRecords(source);
    assert.ok([...records.values()].some(row => row.payload));
    for (const record of records.values()) if (record.payload) assert.ok(record.payload.length <= 256 * 1024);
    restoreRecords(target, records);
    for (const table of ['users', 'audit_logs', 'categories', 'kpis']) assert.deepEqual(all(target, 'SELECT * FROM ' + table + ' ORDER BY id'), all(source, 'SELECT * FROM ' + table + ' ORDER BY id'));
    assert.throws(() => exec(target, 'DELETE FROM audit_logs'));
    assert.throws(() => exec(target, 'INSERT INTO user_categories VALUES(9999,1)'));
    const partial = new Map(records);
    const firstPart = [...partial].find(([, doc]) => doc.payload)!;
    partial.delete(firstPart[0]);
    const empty = openDb(':memory:');
    try { migrate(empty); assert.throws(() => restoreRecords(empty, partial), /incomplete/); } finally { empty.close(); }
  } finally { source.close(); target.close(); }
});

test('Firestore commits are atomic, cached reads check revisions, and failed commits never poison the cache', async () => {
  const remote = new MemoryFirestore();
  const database = new FirestoreDatabase(remote.asFirestore());
  await database.run(db => exec(db, 'INSERT INTO categories(name) VALUES(?)', 'Saved cloud category'));
  assert.ok(remote.documents.has(STATE));
  const scans = remote.scans;
  assert.equal(await database.run(db => one(db, 'SELECT count(*) AS n FROM categories')!.n), 9);
  assert.equal(remote.scans, scans);
  remote.failCommit = true;
  await assert.rejects(database.run(db => exec(db, 'INSERT INTO categories(name) VALUES(?)', 'Must roll back')));
  remote.failCommit = false;
  assert.equal(await database.run(db => one(db, 'SELECT count(*) AS n FROM categories')!.n), 9);
  const secondInstance = new FirestoreDatabase(remote.asFirestore());
  await secondInstance.run(db => exec(db, 'INSERT INTO categories(name) VALUES(?)', 'Other process'));
  assert.equal(await database.run(db => one(db, 'SELECT count(*) AS n FROM categories')!.n), 10);
  assert.ok(remote.scans > scans);
  const state = remote.documents.get(STATE)!;
  remote.documents.set(STATE, { ...state, schema: 'incompatible' });
  await assert.rejects(database.run(() => undefined), /schema upgrade/);
  assert.ok([...remote.documents.keys()].some(key => key.startsWith(RECORDS + '/')));
});

test('hosted API persists logins, reports and binary attachments, enforces isolation and withholds failed commits', async () => {
  const remote = new MemoryFirestore();
  const database = new FirestoreDatabase(remote.asFirestore());
  const seed = await fixture();
  try { await database.run(db => restoreRecords(db, captureRecords(seed))); } finally { seed.close(); }
  const files = new Map<string, Buffer>();
  const server = createHostedApp(database, () => memoryAttachments(files)).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const request = async (path: string, cookie = '', csrf = '', body?: unknown, method = body ? 'POST' : 'GET') => fetch(base + '/api' + path, {
    method, headers: { ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const login = async (email: string) => {
    const result = await request('/auth/login', '', '', { email, password: TEST_PASSWORD });
    assert.equal(result.status, 200);
    const body = await result.json();
    return { cookie: result.headers.get('set-cookie')!.split(';')[0], csrf: body.csrf };
  };
  try {
    assert.equal((await request('/health')).status, 200);
    assert.equal((await request('/bootstrap')).status, 401);
    const employee = await login('outreach@example.test');
    const other = await login('developer@example.test');
    assert.ok(employee.cookie.startsWith('__session='));
    assert.equal((await request('/bootstrap', employee.cookie)).status, 200);
    const draftResponse = await request('/reports', employee.cookie, employee.csrf, reportBody('2026-10-15'));
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    const bytes = Buffer.from('col1,col2\nAlpha,42\n');
    const upload = await fetch(base + '/api/reports/' + draft.id + '/files', {
      method: 'POST', headers: { cookie: employee.cookie, 'x-csrf-token': employee.csrf, 'x-file-name': 'fixture.csv', 'Content-Type': 'application/octet-stream' }, body: bytes
    });
    assert.equal(upload.status, 201);
    const file = (await upload.json()).file;
    const download = await request('/files/' + file.id, employee.cookie);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await request('/files/' + file.id, other.cookie)).status, 403);
    remote.failCommit = true;
    const failed = await request('/reflections', employee.cookie, employee.csrf, { start: '2026-10-15', end: '2026-10-15', self_assessment: 'Must not persist', next_plan: '' });
    assert.equal(failed.status, 409);
    remote.failCommit = false;
    assert.equal(await database.run(db => one(db, 'SELECT count(*) AS n FROM reflections')!.n), 0);
    const deletion = await request('/files/' + file.id, employee.cookie, employee.csrf, undefined, 'DELETE');
    assert.equal(deletion.status, 200);
    assert.equal(files.size, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
