import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firebaseClients } from './firebase-client.mjs';
import { FirestoreDatabase, captureRecords } from '../build/server/firestore-store.js';
import { FirestoreAttachments } from '../build/server/firestore-attachments.js';
import { all } from '../build/server/db.js';

const { firestore } = firebaseClients();
const local = new DatabaseSync(resolve('data/reporting.sqlite'), { readOnly: true });
local.exec('BEGIN');
const expected = captureRecords(local);
const files = all(local, 'SELECT storage_name FROM report_files');
local.exec('COMMIT');
local.close();
const cloud = await new FirestoreDatabase(firestore).run(db => captureRecords(db));
const ignoredTables = new Set(['sessions', 'login_attempts']);
for (const [key, record] of expected) {
  if (ignoredTables.has(record.table)) continue;
  const actual = cloud.get(key);
  assert.ok(actual, 'A migrated record is missing.');
  assert.deepEqual(actual, record, 'A migrated record differs.');
}
assert.equal([...cloud.values()].filter(r => !ignoredTables.has(r.table)).length, [...expected.values()].filter(r => !ignoredTables.has(r.table)).length);
const attachments = new FirestoreAttachments(firestore);
for (const file of files) {
  if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(file.storage_name)) throw Error('Invalid attachment name.');
  assert.deepEqual(await attachments.get(file.storage_name), await readFile(resolve('data/uploads', file.storage_name)), 'An attachment differs.');
}
console.log(JSON.stringify({ result: 'PASS', recordsVerified: expected.size, attachmentsVerified: files.length }));
await firestore.terminate();
