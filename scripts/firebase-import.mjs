import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { firebaseClients } from './firebase-client.mjs';
import { FirestoreDatabase, captureRecords, restoreRecords } from '../build/server/firestore-store.js';
import { all, one, exec } from '../build/server/db.js';
import { FirestoreAttachments } from '../build/server/firestore-attachments.js';

const { firestore, projectId, account } = firebaseClients();
const pathIndex = process.argv.indexOf('--database');
const path = resolve(pathIndex < 0 ? './data/reporting.sqlite' : process.argv[pathIndex + 1]);
const source = new DatabaseSync(path, { readOnly: true });
source.exec('BEGIN');
const records = captureRecords(source);
const files = all(source, 'SELECT storage_name,mime_type,byte_size FROM report_files');
const counts = { users: one(source, 'SELECT count(*) AS n FROM users').n, reports: one(source, 'SELECT count(*) AS n FROM reports').n, files: files.length, documents: records.size };
source.exec('COMMIT');
source.close();
console.log(JSON.stringify({ projectId, account, ...counts, dryRun: !process.argv.includes('--apply') }));
if (process.argv.includes('--apply')) {
  if (!counts.users) throw Error('No local users exist. Create the first admin locally before importing.');
  // Upload before switching database authority; an interrupted import can be safely resumed.
  for (const file of files) {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(file.storage_name)) throw Error('Invalid local attachment path.');
    const bytes = await readFile(resolve('data/uploads', file.storage_name));
    if (bytes.length !== file.byte_size) throw Error('An attachment is incomplete. Import stopped.');
    const attachments = new FirestoreAttachments(firestore);
    if ((await firestore.collection('cadenceAttachments').doc(file.storage_name).get()).exists) {
      if (!(await attachments.get(file.storage_name)).equals(bytes)) throw Error('An existing cloud attachment differs from the local file.');
    } else {
      await attachments.put(file.storage_name, bytes, file.mime_type);
      await attachments.prepare();
    }
  }
  await new FirestoreDatabase(firestore).run(db => {
    if (one(db, 'SELECT count(*) AS n FROM users').n || one(db, 'SELECT count(*) AS n FROM reports').n) throw Error('Cloud data already exists. Import refuses to overwrite it.');
    restoreRecords(db, records);
    // Old local/browser sessions must not become cloud sessions.
    exec(db, 'DELETE FROM sessions');
    exec(db, 'DELETE FROM login_attempts');
    if (one(db, 'SELECT count(*) AS n FROM users').n !== counts.users || one(db, 'SELECT count(*) AS n FROM reports').n !== counts.reports) throw Error('Migration verification failed.');
  });
  console.log('Data import committed. Existing accounts and passwords were preserved; sign in again.');
}
await firestore.terminate();
