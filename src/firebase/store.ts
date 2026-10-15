import { collection, doc, getDocFromServer, getDocsFromServer, query, where, runTransaction, serverTimestamp, type DocumentReference, type Transaction } from 'firebase/firestore';
import { firestore, auth } from './config';
import { openProjection, insertRows, all, one, type DB } from './database';
import { captureConfig, captureProfile, captureReport, reportKey, sameData, checkDocumentSize, type SparkConfig, type SparkProfile, type SparkReport } from '../../shared/spark-data';
import type { Row } from '../../shared/query';

export type Loaded = { db: DB; config: SparkConfig; profiles: Map<string, SparkProfile>; reports: Map<string, SparkReport>; user: Row };
export async function loadWorkspace(): Promise<Loaded> {
  await auth.authStateReady();
  if (!auth.currentUser) throw Error('Please sign in.');
  const mine = await getDocFromServer(doc(firestore, 'cadenceProfiles', auth.currentUser.uid));
  if (!mine.exists() || mine.data().row.active !== 1) throw Error('Your workspace account is unavailable. Contact your administrator.');
  const profile = mine.data() as SparkProfile;
  const admin = profile.row.access === 'admin';
  const [configSnapshot, profileSnapshot, reportSnapshot] = await Promise.all([
    getDocFromServer(doc(firestore, 'cadenceConfig', 'main')),
    admin ? getDocsFromServer(collection(firestore, 'cadenceProfiles')) : Promise.resolve(null),
    getDocsFromServer(admin ? collection(firestore, 'cadenceReports') : query(collection(firestore, 'cadenceReports'), where('owner', '==', profile.row.id)))
  ]);
  if (!configSnapshot.exists()) throw Error('The workspace is not ready. Contact your administrator.');
  const config = configSnapshot.data() as SparkConfig;
  const profiles = new Map<string, SparkProfile>(profileSnapshot ? profileSnapshot.docs.map(d => [d.id, d.data() as SparkProfile]) : [[mine.id, profile]]);
  const reports = new Map(reportSnapshot.docs.map(d => [d.id, d.data() as SparkReport]));
  const db = await openProjection();
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    for (const [table, rows] of Object.entries(config.tables)) insertRows(db, table, rows);
    for (const p of profiles.values()) {
      insertRows(db, 'users', [{ ...p.row, password_hash: '' }]);
      insertRows(db, 'user_categories', p.category_ids.map(category_id => ({ user_id: p.row.id, category_id })));
      for (const [table, rows] of Object.entries(p.tables)) insertRows(db, table, rows.map(row => ({ ...row, user_id: p.row.id })));
    }
    // Only names and roles of reviewers are shared with employees, for feedback attribution.
    for (const r of config.reviewers) insertRows(db, 'users', [{ ...r, email: `reviewer-${r.id}@internal.invalid`, password_hash: '', employee_code: `REVIEWER-${r.id}`, access: 'admin', joining_date: '0001-01-01', created_at: '2000-01-01T00:00:00.000Z' }]);
    for (const r of reports.values()) {
      // Reporting compliance uses Firebase's timestamps, never a browser-supplied clock.
      const wire = r as SparkReport & Record<string, any>;
      insertRows(db, 'reports', [{ ...r.report, created_at: wire.createdAt?.toDate?.().toISOString() || r.report.created_at, updated_at: wire.changedAt?.toDate?.().toISOString() || r.report.updated_at, submitted_at: wire.submittedAt?.toDate?.().toISOString() || null, first_submitted_at: wire.firstSubmittedAt?.toDate?.().toISOString() || null }]);
      for (const a of r.activities) {
        const { links, ...rawActivity } = a;
        const activity: Row = { ...rawActivity, report_id: r.report.id };
        const columns = Object.keys(activity);
        const result = db.prepare(`INSERT INTO activities(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(k => activity[k]));
        insertRows(db, 'activity_links', (links || []).map((url: string) => ({ activity_id: result.lastInsertRowid, url, created_at: r.report.updated_at })));
      }
      insertRows(db, 'report_files', Object.values(r.files).map(f => ({ ...f, report_id: r.report.id, user_id: r.owner })));
      insertRows(db, 'feedback', r.feedback.map(f => ({ ...f, report_id: r.report.id, user_id: r.owner })));
    }
    db.exec('PRAGMA foreign_keys=ON');
    return { db, config, profiles, reports, user: one(db, 'SELECT u.*,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', profile.row.id)! };
  } catch (e) { db.close(); throw e; }
}
export type ExtraWrites = { reads?: DocumentReference[]; apply?: (tx: Transaction) => void; newProfile?: { uid: string; id: number } };
export async function commitWorkspace(loaded: Loaded, extra: ExtraWrites = {}) {
  const { db, config, profiles, reports, user } = loaded;
  const actorUid = auth.currentUser!.uid;
  const admin = user.access === 'admin';
  const changes: { ref: DocumentReference; before?: Row; after: Row }[] = [];
  const nextConfig = captureConfig(db, config.revision + 1);
  // Serialize admin operations across shared role/target IDs and membership changes.
  if (admin || !sameData(config, nextConfig)) changes.push({ ref: doc(firestore, 'cadenceConfig', 'main'), before: config, after: nextConfig });
  const known = new Map(profiles);
  if (extra.newProfile) known.set(extra.newProfile.uid, { revision: -1, uid: extra.newProfile.uid, row: { id: extra.newProfile.id }, tables: {}, category_ids: [] });
  for (const [uid, before] of known) {
    const row = one(db, 'SELECT * FROM users WHERE id=?', before.row.id);
    if (!row) continue;
    const after = captureProfile(db, row, uid, before.revision + 1);
    if (!sameData(before, after)) changes.push({ ref: doc(firestore, 'cadenceProfiles', uid), before: before.revision < 0 ? undefined : before, after });
  }
  const changedReports: { key: string; after: SparkReport; isRevision: boolean }[] = [];
  for (const r of all(db, 'SELECT * FROM reports')) {
    const key = reportKey(r), before = reports.get(key);
    const ownerUid = [...known].find(([, p]) => p.row.id === r.user_id)?.[0];
    if (!ownerUid) throw Error('Report owner is missing. Refresh and try again.');
    const after = captureReport(db, r, ownerUid, (before?.revision ?? -1) + 1);
    if (before) {
      // Server timestamps are stored separately. Keep legacy text fields stable so a review
      // changes only review status/version, and attaching a file does not change report content.
      for (const key of ['created_at', 'submitted_at', 'first_submitted_at']) after.report[key] = before.report[key];
      if (before.report.version === after.report.version) after.report.updated_at = before.report.updated_at;
    }
    if (!sameData(before, after)) {
      changes.push({ ref: doc(firestore, 'cadenceReports', key), before, after });
      changedReports.push({ key, after, isRevision: !before || before.report.version !== after.report.version });
    }
  }
  const auditRows = all(db, 'SELECT * FROM audit_logs');
  const notifications = all(db, 'SELECT * FROM notifications');
  if (!changes.length && !auditRows.length && !notifications.length && !extra.apply) return;
  for (const c of changes) checkDocumentSize(c.after);
  if (changes.length + auditRows.length + notifications.length > 350) throw Error('Too many records changed. Use a smaller operation.');
  await runTransaction(firestore, async tx => {
    // All authoritative reads precede every write. Reject stale views instead of overwriting them.
    const current = await Promise.all(changes.map(c => tx.get(c.ref)));
    if (extra.reads) await Promise.all(extra.reads.map(ref => tx.get(ref)));
    for (let i = 0; i < changes.length; i++) {
      const { before } = changes[i];
      if (before ? !current[i].exists() || current[i].get('revision') !== before.revision : current[i].exists()) throw Error('This workspace changed in another window. Refresh and try again.');
    }
    const reportWires = new Map<string, Row>();
    for (const c of changes) {
      const isReport = c.ref.parent.id === 'cadenceReports';
      const submitted = isReport && ['submitted', 'corrected'].includes(c.after.report.status) && c.before?.report.status !== c.after.report.status;
      const wire = { ...c.after, actorUid, changedAt: serverTimestamp(), ...(isReport ? {
        createdAt: c.before?.createdAt || serverTimestamp(),
        firstSubmittedAt: c.before?.firstSubmittedAt || (submitted ? serverTimestamp() : null),
        submittedAt: submitted ? serverTimestamp() : c.before?.submittedAt || null
      } : {}) };
      tx.set(c.ref, wire);
      if (isReport) reportWires.set(c.ref.id, wire);
    }
    for (const { key, after, isRevision } of changedReports) if (isRevision) tx.set(doc(firestore, 'cadenceReports', key, 'history', String(after.report.version)), { owner: after.owner, reportKey: key, version: after.report.version, state: reportWires.get(key), actorUid, createdAt: serverTimestamp() });
    for (const a of auditRows) {
      const { id: _id, ...row } = a;
      tx.set(doc(collection(firestore, 'cadenceAudit')), { ...row, actorUid, recordedAt: serverTimestamp() });
    }
    for (const n of notifications) {
      const { id: _id, ...row } = n;
      const key = `${n.user_id}_${encodeURIComponent(n.period)}_${n.kind}`;
      tx.set(doc(firestore, 'cadenceNotifications', key), { ...row, owner: n.user_id, actorUid, changedAt: serverTimestamp() });
    }
    extra.apply?.(tx);
  });
}
