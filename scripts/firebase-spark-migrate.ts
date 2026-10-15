import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { gzipSync } from 'fflate';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from '@google-cloud/firestore';
import { firebaseClients } from './firebase-client.mjs';
import { openDb, migrate, all, type Row } from '../server/db.js';
import { restoreRecords, STATE, RECORDS } from '../server/firestore-store.js';
import { FirestoreAttachments } from '../server/firestore-attachments.js';
import { captureConfig, captureProfile, captureReport, reportKey, checkDocumentSize } from '../shared/spark-data.js';

const { projectId, client, firestore } = firebaseClients();
const apply = process.argv.includes('--apply');
let adminApp: ReturnType<typeof initializeApp> | undefined;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
try {
  const billing = (await client.request({ url: `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo` })).data;
  if (billing.billingEnabled) throw Error('Expected the project to remain on the free plan.');
  if ((await firestore.doc('cadenceConfig/main').get()).exists) throw Error('The Firebase-only workspace already exists. Migration will not overwrite live data.');
  const db = openDb(':memory:'); migrate(db);
  const sourceRevision = await firestore.runTransaction(async tx => {
    const state = await tx.get(firestore.doc(STATE));
    if (!state.exists) throw Error('The existing cloud database is missing.');
    const source = await tx.get(firestore.collection(RECORDS));
    restoreRecords(db, new Map(source.docs.map(d => [d.id, d.data()])));
    return state.get('revision');
  });
  const users = all(db, 'SELECT * FROM users ORDER BY id');
  const reports = all(db, 'SELECT * FROM reports ORDER BY id');
  const files = all(db, 'SELECT * FROM report_files ORDER BY id');
  const config = captureConfig(db, 0); checkDocumentSize(config);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', users: users.length, reports: reports.length, files: files.length, sourceRevision, billingEnabled: false }));
  } else {
    adminApp = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: (await client.getAccessToken()).token!, expires_in: 3600 }) } }, 'spark-migration');
    const auth = getAuth(adminApp);
    const existing = new Map<string, string>();
    let pageToken: string | undefined;
    do { const page = await auth.listUsers(1000, pageToken); for (const u of page.users) if (u.email) existing.set(u.email.toLowerCase(), u.uid); pageToken = page.pageToken; } while (pageToken);
    const uidFor = (u: Row) => existing.get(u.email.toLowerCase()) || `cadence-${u.id}`;
    const missing = users.filter(u => !existing.has(u.email.toLowerCase()));
    if (missing.length) {
      const result = await auth.importUsers(missing.map(u => {
        const [salt, hash] = u.password_hash.split(':');
        if (!salt || !hash) throw Error('An existing account has an unsupported password hash.');
        return { uid: uidFor(u), email: u.email, displayName: u.name, disabled: false, passwordHash: Buffer.from(hash, 'hex'), passwordSalt: Buffer.from(salt, 'utf8') };
      }), { hash: { algorithm: 'STANDARD_SCRYPT', memoryCost: 16384, parallelization: 1, blockSize: 8, derivedKeyLength: 64 } });
      if (result.failureCount) throw Error(`Authentication import failed for ${result.failureCount} accounts: ${result.errors.map(e => e.error.code).join(', ')}`);
    }
    // Verify the exact Node scrypt parameters using a disposable account, never a real password.
    const testUid = `migration-check-${randomBytes(10).toString('hex')}`;
    const password = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
    try {
      const result = await auth.importUsers([{ uid: testUid, email: `${testUid}@example.invalid`, passwordHash: scryptSync(password, salt, 64), passwordSalt: Buffer.from(salt, 'utf8') }], { hash: { algorithm: 'STANDARD_SCRYPT', memoryCost: 16384, parallelization: 1, blockSize: 8, derivedKeyLength: 64 } });
      if (result.failureCount) throw Error('Password compatibility verification failed.');
      const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAXKAm7mF6v8y4JJMyPkGYuK9_UK5oxLFg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${testUid}@example.invalid`, password, returnSecureToken: true }) });
      const data = await response.json();
      if (!response.ok || data.localId !== testUid) throw Error('Firebase did not accept the migrated password format.');
      console.log('Existing password hash format verified with a disposable account.');
    } finally { await auth.deleteUser(testUid).catch(() => {}); }
    const documents: { path: string; data: Row }[] = [];
    documents.push({ path: 'cadenceConfig/main', data: { ...config, changedAt: Timestamp.now(), actorUid: 'migration' } });
    for (const u of users) documents.push({ path: `cadenceProfiles/${uidFor(u)}`, data: { ...captureProfile(db, u, uidFor(u)), changedAt: Timestamp.now(), actorUid: 'migration' } });
    for (const r of reports) {
      const owner = users.find(u => u.id === r.user_id)!;
      documents.push({ path: `cadenceReports/${reportKey(r)}`, data: {
        ...captureReport(db, r, uidFor(owner)), changedAt: Timestamp.fromDate(new Date(r.updated_at)), createdAt: Timestamp.fromDate(new Date(r.created_at)), firstSubmittedAt: r.first_submitted_at ? Timestamp.fromDate(new Date(r.first_submitted_at)) : null, submittedAt: r.submitted_at ? Timestamp.fromDate(new Date(r.submitted_at)) : null, actorUid: 'migration'
      } });
    }
    for (const h of all(db, 'SELECT * FROM report_revisions')) {
      const r = reports.find(r => r.id === h.report_id)!;
      documents.push({ path: `cadenceReports/${reportKey(r)}/history/${h.version}`, data: { owner: r.user_id, reportKey: reportKey(r), version: h.version, legacySnapshot: h.snapshot, actorUid: uidFor(users.find(u => u.id === h.actor_id) || users.find(u => u.id === r.user_id)!), createdAt: Timestamp.fromDate(new Date(h.created_at)) } });
    }
    for (const a of all(db, 'SELECT * FROM audit_logs')) {
      const actor = users.find(u => u.id === a.actor_id), { id, ...row } = a;
      documents.push({ path: `cadenceAudit/legacy-${id}`, data: { ...row, actorUid: actor ? uidFor(actor) : 'legacy-system', recordedAt: Timestamp.fromDate(new Date(a.created_at)) } });
    }
    for (const n of all(db, 'SELECT * FROM notifications')) {
      const { id: _id, ...row } = n;
      documents.push({ path: `cadenceNotifications/${n.user_id}_${encodeURIComponent(n.period)}_${n.kind}`, data: { ...row, owner: n.user_id, actorUid: 'legacy-system', changedAt: Timestamp.fromDate(new Date(n.created_at)) } });
    }
    const attachments = new FirestoreAttachments(firestore as any);
    for (const f of files) {
      const r = reports.find(r => r.id === f.report_id)!;
      const bytes = await attachments.get(f.storage_name);
      const values = all(db, 'SELECT values_json FROM report_file_rows WHERE file_id=? ORDER BY row_number', f.id).map(r => JSON.parse(r.values_json));
      const raw = Buffer.from(JSON.stringify(values)), compressed = gzipSync(raw);
      const parts = (data: Uint8Array, kind: string) => Array.from({ length: Math.ceil(data.length / 262144) }, (_, index) => ({ path: `cadenceFiles/${f.id}/parts/${kind}-${index}`, data: { kind, index, bytes: Buffer.from(data.slice(index * 262144, (index + 1) * 262144)) } }));
      documents.push({ path: `cadenceFiles/${f.id}`, data: { owner: r.user_id, reportKey: reportKey(r), metadata: f, dataChunks: Math.ceil(bytes.length / 262144), rowChunks: Math.ceil(compressed.length / 262144), sha256: sha(bytes), rowSha256: sha(compressed), rowBytes: raw.length } }, ...parts(bytes, 'bytes'), ...parts(compressed, 'rows'));
    }
    for (const d of documents.filter(d => !d.path.includes('/parts/'))) checkDocumentSize(d.data);
    if (documents.length > 450) throw Error('Migration exceeds the atomic import limit. A staged migration is needed.');
    await firestore.runTransaction(async tx => {
      const state = await tx.get(firestore.doc(STATE));
      const target = await tx.get(firestore.doc('cadenceConfig/main'));
      if (target.exists || state.get('revision') !== sourceRevision) throw Error('The source changed during migration. Stop the old preview and retry.');
      for (const d of documents) tx.create(firestore.doc(d.path), d.data);
    });
    const cloudReports = await firestore.collection('cadenceReports').get();
    const cloudProfiles = await firestore.collection('cadenceProfiles').get();
    if (cloudReports.size !== reports.length || cloudProfiles.size !== users.length) throw Error('Cloud record count verification failed.');
    console.log(JSON.stringify({ migratedUsers: users.length, migratedReports: reports.length, migratedFiles: files.length, documents: documents.length, billingEnabled: false }));
  }
  db.close();
} catch (error: any) {
  console.error(error.response?.data?.error?.message || error.message || 'Migration failed.');
  process.exitCode = 1;
} finally { if (adminApp) await deleteApp(adminApp); await firestore.terminate(); }
