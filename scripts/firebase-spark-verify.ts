import { createHash } from 'node:crypto';
import { gunzipSync } from 'fflate';
import { firebaseClients } from './firebase-client.mjs';
import { openDb, migrate, all } from '../server/db.js';
import { restoreRecords, RECORDS } from '../server/firestore-store.js';
import { FirestoreAttachments } from '../server/firestore-attachments.js';
import { captureProfile, captureReport, captureConfig, reportKey, sameData } from '../shared/spark-data.js';
const { projectId, client, firestore } = firebaseClients();
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
try {
  const db = openDb(':memory:'); migrate(db);
  const legacy = await firestore.collection(RECORDS).get();
  restoreRecords(db, new Map(legacy.docs.map(d => [d.id, d.data()])));
  const profiles = await firestore.collection('cadenceProfiles').get();
  const reports = await firestore.collection('cadenceReports').get();
  const users = all(db, 'SELECT * FROM users');
  if (users.length !== profiles.size || all(db, 'SELECT id FROM reports').length !== reports.size) throw Error('Migration record counts do not match.');
  if (!sameData(captureConfig(db), (await firestore.doc('cadenceConfig/main').get()).data())) throw Error('Configuration verification failed.');
  for (const u of users) {
    const p = profiles.docs.find(p => p.get('row.id') === u.id);
    if (!p || !sameData(captureProfile(db, u, p.id), p.data()) || Object.hasOwn(p.get('row'), 'password_hash')) throw Error('Safe profile verification failed.');
  }
  for (const r of all(db, 'SELECT * FROM reports')) {
    const p = profiles.docs.find(p => p.get('row.id') === r.user_id)!;
    const cloud = reports.docs.find(d => d.id === reportKey(r));
    if (!cloud || !sameData(captureReport(db, r, p.id), cloud.data())) throw Error('Report contents do not match the source.');
    if ((cloud.get('firstSubmittedAt')?.toDate().toISOString() || null) !== r.first_submitted_at) throw Error('Original submission timestamp verification failed.');
  }
  const oldFiles = new FirestoreAttachments(firestore as any);
  const files = all(db, 'SELECT * FROM report_files');
  for (const f of files) {
    const manifest = await firestore.doc(`cadenceFiles/${f.id}`).get();
    const parts = await manifest.ref.collection('parts').get();
    const join = (kind: string) => Buffer.concat(parts.docs.filter(d => d.get('kind') === kind).sort((a, b) => a.get('index') - b.get('index')).map(d => Buffer.from(d.get('bytes'))));
    const bytes = join('bytes'), rows = join('rows');
    if (!bytes.equals(await oldFiles.get(f.storage_name)) || hash(bytes) !== manifest.get('sha256') || hash(rows) !== manifest.get('rowSha256')) throw Error('Attachment byte verification failed.');
    const parsed = JSON.parse(Buffer.from(gunzipSync(rows)).toString('utf8'));
    const expected = all(db, 'SELECT values_json FROM report_file_rows WHERE file_id=? ORDER BY row_number', f.id).map(r => JSON.parse(r.values_json));
    if (!sameData(parsed, expected)) throw Error('Parsed spreadsheet verification failed.');
  }
  const billing = (await client.request({ url: `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo` })).data;
  if (billing.billingEnabled) throw Error('Billing unexpectedly enabled.');
  console.log(JSON.stringify({ verifiedProfiles: profiles.size, verifiedReports: reports.size, verifiedFiles: files.length, passwordHashesExposed: false, billingEnabled: false }));
  db.close();
} catch (error: any) { console.error(error.response?.data?.error?.message || error.message || 'Verification failed.'); process.exitCode = 1; }
finally { await firestore.terminate(); }
