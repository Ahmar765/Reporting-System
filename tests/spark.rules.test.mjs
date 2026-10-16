import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, Bytes } from 'firebase/firestore';
let env;
const time = Timestamp.fromDate(new Date('2026-10-15T10:00:00Z'));
const profile = (id, uid, access = 'employee', active = 1) => ({ revision: 0, uid, row: { id, email: `${uid}@example.test`, name: uid, employee_code: uid, access, active, role_id: 1, joining_date: '2026-01-01', timezone: 'Asia/Karachi', workdays: '[1,2,3,4,5]', deadline: '22:00', notifications: 1, email_notifications: 0, created_at: '2026-01-01T00:00:00Z' }, category_ids: [1], tables: { assignments: [], leave_days: [], profile_versions: [], reflections: [], overrides: [] } });
const report = (owner = 2, status = 'draft') => ({ revision: 0, owner, ownerUid: owner === 2 ? 'employee' : 'colleague', report: { id: owner * 100000000 + 20261015, user_id: owner, date: '2026-10-15', status, achievements: '', blockers: '', missed_reason: '', lessons: '', suggestions: '', next_plan: '', assistance: '', created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z', submitted_at: null, first_submitted_at: null, version: 1, employee_edit_count: 0, employee_edit_open: 0 }, activities: [], files: {}, feedback: [], createdAt: time, firstSubmittedAt: status === 'draft' ? null : time, submittedAt: status === 'draft' ? null : time, changedAt: time, actorUid: 'employee' });
const db = (uid = 'employee') => env.authenticatedContext(uid).firestore();
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-cadence', firestore: { host: '127.0.0.1', port: 8085, rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await Promise.all([setDoc(doc(d, 'cadenceProfiles/admin'), profile(1, 'admin', 'admin')), setDoc(doc(d, 'cadenceProfiles/employee'), profile(2, 'employee')), setDoc(doc(d, 'cadenceProfiles/colleague'), profile(3, 'colleague')), setDoc(doc(d, 'cadenceProfiles/inactive'), profile(4, 'inactive', 'employee', 0)), setDoc(doc(d, 'cadenceConfig/main'), { revision: 0, tables: {}, reviewers: [] }), setDoc(doc(d, 'cadenceReports/2_2026-10-15'), report()), setDoc(doc(d, 'cadenceReports/3_2026-10-15'), report(3)), setDoc(doc(d, 'cadenceRecords/private'), { password_hash: 'fixture-secret' })]);
  });
});
test('anonymous, uninvited, inactive, and cross-employee reads are denied', async () => {
  for (const d of [env.unauthenticatedContext().firestore(), db('uninvited'), db('inactive')]) await assertFails(getDoc(doc(d, 'cadenceReports/2_2026-10-15')));
  await assertFails(getDoc(doc(db(), 'cadenceReports/3_2026-10-15')));
  await assertFails(getDoc(doc(db(), 'cadenceProfiles/colleague')));
  await assertFails(getDocs(collection(db(), 'cadenceReports')));
  await assertSucceeds(getDocs(query(collection(db(), 'cadenceReports'), where('owner', '==', 2))));
  await assertSucceeds(getDocs(collection(db('admin'), 'cadenceReports')));
  await assertFails(getDoc(doc(db('admin'), 'cadenceRecords/private')));
});
test('employees cannot promote themselves, alter targets, forge timestamps, or overwrite stale versions', async () => {
  const p = profile(2, 'employee');
  await assertFails(setDoc(doc(db(), 'cadenceProfiles/employee'), { ...p, revision: 1, row: { ...p.row, access: 'admin' }, changedAt: serverTimestamp(), actorUid: 'employee' }));
  await assertFails(setDoc(doc(db(), 'cadenceProfiles/employee'), { ...p, revision: 1, tables: { ...p.tables, assignments: [{ target: 1 }] }, changedAt: serverTimestamp(), actorUid: 'employee' }));
  await assertFails(updateDoc(doc(db(), 'cadenceReports/2_2026-10-15'), { changedAt: time, revision: 1, actorUid: 'employee' }));
  await assertFails(updateDoc(doc(db(), 'cadenceReports/2_2026-10-15'), { changedAt: serverTimestamp(), revision: 2, actorUid: 'employee' }));
});
test('submission locks a report, preserves trusted timestamps, and writes immutable history', async () => {
  const d = db(), r = report();
  const next = { ...r, revision: 1, report: { ...r.report, version: 2, status: 'submitted', achievements: 'Fixture work', next_plan: 'Next step' } };
  const batch = writeBatch(d);
  batch.set(doc(d, 'cadenceReports/2_2026-10-15'), { ...next, changedAt: serverTimestamp(), firstSubmittedAt: serverTimestamp(), submittedAt: serverTimestamp() });
  batch.set(doc(d, 'cadenceReports/2_2026-10-15/history/2'), { owner: 2, reportKey: '2_2026-10-15', version: 2, state: { ...next, firstSubmittedAt: serverTimestamp(), submittedAt: serverTimestamp() }, actorUid: 'employee', createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(d, 'cadenceReports/2_2026-10-15'), { 'report.achievements': 'Changed after submission', 'report.version': 3, revision: 2, changedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(d, 'cadenceReports/2_2026-10-15/history/2'), { version: 9 }));
  await assertFails(deleteDoc(doc(d, 'cadenceReports/2_2026-10-15/history/2')));
  const adminDb = db('admin'), current = (await getDoc(doc(adminDb, 'cadenceReports/2_2026-10-15'))).data();
  const corrected = { ...current, report: { ...current.report, status: 'correction_requested', version: 3 }, revision: 2, actorUid: 'admin', changedAt: serverTimestamp() };
  const review = writeBatch(adminDb);
  review.set(doc(adminDb, 'cadenceReports/2_2026-10-15'), corrected);
  review.set(doc(adminDb, 'cadenceReports/2_2026-10-15/history/3'), { owner: 2, reportKey: '2_2026-10-15', version: 3, state: corrected, actorUid: 'admin', createdAt: serverTimestamp() });
  await assertSucceeds(review.commit());
});
test('employee cannot change feedback, ownership, or another employee report through a forged numeric ID', async () => {
  await assertFails(updateDoc(doc(db(), 'cadenceReports/2_2026-10-15'), { feedback: [{ quality: 100 }], revision: 1, changedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db(), 'cadenceReports/2_2026-10-15'), { owner: 3, revision: 1, changedAt: serverTimestamp() }));
  const r = report(); r.report.date = '2026-10-14'; r.report.id = report(3).report.id;
  await assertFails(setDoc(doc(db(), 'cadenceReports/2_2026-10-14'), { ...r, createdAt: serverTimestamp(), changedAt: serverTimestamp() }));
});
test('private file bytes require an editable report and an atomic manifest', async () => {
  const d = db(), key = '2_2026-10-15', id = 'fixture-file', r = report();
  const metadata = { id, report_id: r.report.id, user_id: 2, original_name: 'fixture.txt', byte_size: 4 };
  const manifest = { owner: 2, reportKey: key, metadata, dataChunks: 1, rowChunks: 1, rowBytes: 2, sha256: 'fixture', rowSha256: 'fixture' };
  const batch = writeBatch(d);
  batch.update(doc(d, 'cadenceReports', key), { files: { [id]: metadata }, revision: 1, changedAt: serverTimestamp() });
  batch.set(doc(d, 'cadenceFiles', id), manifest);
  batch.set(doc(d, 'cadenceFiles', id, 'parts/bytes-0'), { kind: 'bytes', index: 0, bytes: Bytes.fromUint8Array(new Uint8Array([1, 2, 3, 4])) });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(d, 'cadenceFiles', id, 'parts/bytes-0')));
  await assertFails(getDoc(doc(db('colleague'), 'cadenceFiles', id, 'parts/bytes-0')));
  await assertFails(deleteDoc(doc(d, 'cadenceFiles', id, 'parts/bytes-0')));
  await assertFails(setDoc(doc(d, 'cadenceFiles', id, 'parts/bytes-1'), { kind: 'bytes', index: 1, bytes: Bytes.fromUint8Array(new Uint8Array([1])) }));
  const remove = writeBatch(d);
  remove.update(doc(d, 'cadenceReports', key), { files: {}, revision: 2, changedAt: serverTimestamp() });
  remove.delete(doc(d, 'cadenceFiles', id, 'parts/bytes-0')); remove.delete(doc(d, 'cadenceFiles', id));
  await assertSucceeds(remove.commit());
});
test('audit events are attributed to the caller and cannot be edited or deleted', async () => {
  const ref = doc(db(), 'cadenceAudit/event');
  await assertFails(setDoc(ref, { actorUid: 'admin', actor_id: 1, recordedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(ref, { actorUid: 'employee', actor_id: 2, recordedAt: serverTimestamp(), action: 'report.saved' }));
  await assertFails(updateDoc(doc(db('admin'), 'cadenceAudit/event'), { action: 'edited' }));
  await assertFails(deleteDoc(doc(db('admin'), 'cadenceAudit/event')));
});
async function reportTransition(uid, patch, extra = {}) {
  const d = db(uid), ref = doc(d, 'cadenceReports/2_2026-10-15');
  const old = (await getDoc(ref)).data();
  const next = { ...old, revision: old.revision + 1, report: { ...old.report, version: old.report.version + 1, ...patch }, actorUid: uid, changedAt: serverTimestamp(), ...extra };
  const batch = writeBatch(d);
  batch.set(ref, next);
  batch.set(doc(ref, 'history', String(next.report.version)), { owner: 2, reportKey: '2_2026-10-15', version: next.report.version, state: next, actorUid: uid, createdAt: serverTimestamp() });
  return batch.commit();
}
test('one employee edit survives saves and cannot be reset, reopened, or granted again', async () => {
  await assertSucceeds(reportTransition('employee', { status: 'submitted' }, { firstSubmittedAt: serverTimestamp(), submittedAt: serverTimestamp() }));
  const ref = doc(db(), 'cadenceReports/2_2026-10-15');
  const firstSubmittedAt = (await getDoc(ref)).get('firstSubmittedAt');
  await assertFails(reportTransition('admin', { status: 'correction_requested', employee_edit_count: 1, employee_edit_open: 1 }));
  await assertFails(reportTransition('employee', { status: 'correction_requested', employee_edit_count: 1, employee_edit_open: 1, achievements: 'Cannot combine edit start with content changes' }));
  await assertSucceeds(reportTransition('employee', { status: 'correction_requested', employee_edit_count: 1, employee_edit_open: 1 }));
  await assertFails(reportTransition('employee', { employee_edit_count: 0 }));
  await assertSucceeds(reportTransition('employee', { achievements: 'Updated during the one edit' }));
  await assertSucceeds(reportTransition('employee', { status: 'corrected', employee_edit_open: 0 }, { submittedAt: serverTimestamp() }));
  const after = (await getDoc(ref)).data();
  if (!after.firstSubmittedAt.isEqual(firstSubmittedAt)) throw Error('First submission timestamp changed');
  await assertFails(reportTransition('employee', { status: 'correction_requested', employee_edit_open: 1 }));
  await assertFails(reportTransition('employee', { status: 'correction_requested', employee_edit_count: 0, employee_edit_open: 0 }));
  await assertFails(reportTransition('admin', { status: 'correction_requested' }));
  await assertFails(updateDoc(ref, { files: { forged: {} }, revision: after.revision + 1, changedAt: serverTimestamp() }));
  await assertSucceeds(reportTransition('admin', { status: 'approved' }));
});
test('admins cannot create or modify employee targets, KPIs, or scoring models directly', async () => {
  const d = db('admin'), p = profile(2, 'employee');
  await assertFails(setDoc(doc(d, 'cadenceProfiles/employee'), { ...p, revision: 1, tables: { ...p.tables, assignments: [{ target: 100 }] }, actorUid: 'admin', changedAt: serverTimestamp() }));
  for (const table of ['kpis', 'scoring_configs']) await assertFails(updateDoc(doc(d, 'cadenceConfig/main'), { ['tables.' + table]: [{ id: 1 }], revision: 1, actorUid: 'admin', changedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(d, 'cadenceConfig/main'), { 'tables.roles': [], revision: 1, actorUid: 'admin', changedAt: serverTimestamp() }));
});
