import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail, createUserWithEmailAndPassword, deleteUser, inMemoryPersistence, setPersistence } from 'firebase/auth';
import { collection, doc, getDocsFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ZodError } from 'zod/v4';
import { auth, firestore, firebaseConfig } from './config';
import { loadWorkspace, commitWorkspace } from './store';
import { all, one, insertRows } from './database';
import { ClientRouter, publicUser } from './router';
import { registerReportingRoutes } from './routes';
import { notificationsFor, readNotifications } from './notifications';
import { uploadFile, removeFile, loadParsedRows } from './files';
import { profile } from '../../server/validation';
import type { Row } from '../../shared/query';

function friendly(error: unknown): Error {
  if (error instanceof ZodError) return Error(error.issues.map(i => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; '));
  const code = (error as { code?: string })?.code || '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) return Error('Email or password is incorrect.');
  if (code === 'permission-denied') return Error('This action is not permitted, or your account was deactivated. Refresh and sign in again.');
  if (['auth/network-request-failed', 'unavailable'].includes(code)) return Error('Cannot reach Firebase. Check your internet connection and try again.');
  if (code === 'resource-exhausted') return Error('The free Firebase usage limit has been reached. Please try again after the quota resets.');
  if (code === 'auth/too-many-requests') return Error('Too many attempts. Try again later.');
  return error instanceof Error ? error : Error('The action could not be completed.');
}
export async function firebaseApi(path: string, body?: any, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
  try {
    await auth.authStateReady();
    if (path === '/auth/login') {
      await signInWithEmailAndPassword(auth, body.email, body.password);
      try { const loaded = await loadWorkspace(); const user = publicUser(loaded.user); loaded.db.close(); await recordSignInEvent(); return { user }; }
      catch (e) { await signOut(auth); throw e; }
    }
    if (path === '/auth/logout') { await signOut(auth); return { ok: true }; }
    if (path === '/auth/reset') { await sendPasswordResetEmail(auth, body.email); return { ok: true }; }
    if (!auth.currentUser) throw Error('Please sign in.');
    if (path === '/auth/password') {
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) throw Error('Use a password with 12 to 128 characters.');
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email!, body.current));
      await updatePassword(auth.currentUser, body.password);
      await signOut(auth);
      return { ok: true };
    }
    const loaded = await loadWorkspace();
    const { db, user } = loaded;
    let secondary: ReturnType<typeof initializeApp> | undefined;
    let created: Awaited<ReturnType<typeof createUserWithEmailAndPassword>> | undefined;
    try {
      if (path === '/auth/me') return { user: publicUser(user) };
      if (path === '/notifications/read') return await readNotifications(db, user);
      if (path === '/notifications' || path === '/jobs/run') {
        const result = await notificationsFor(db, user, true);
        return path === '/notifications' ? result.rows : { created: result.created };
      }
      if (path === '/bootstrap') await notificationsFor(db, user, true);
      if (path.startsWith('/audit')) {
        if (user.access !== 'admin') throw Error('Administrator access required.');
        const page = Math.max(1, Number(new URL(path, 'https://cadence.local').searchParams.get('page') || 1));
        const events = (await getDocsFromServer(collection(firestore, 'cadenceAudit'))).docs.map(d => ({ ...d.data(), id: d.id, actor: [...loaded.profiles.values()].find(p => p.uid === d.get('actorUid'))?.row.name || 'System' } as Row)).sort((a, b) => (b.recordedAt?.toMillis?.() || Date.parse(b.created_at)) - (a.recordedAt?.toMillis?.() || Date.parse(a.created_at)));
        return { rows: events.slice((page - 1) * 30, page * 30), total: events.length, page };
      }
      const fileMatch = /^\/files\/([^/?]+)$/.exec(path);
      if (fileMatch && method === 'DELETE') return await removeFile(loaded, fileMatch[1]);
      if (/^\/reports\/\d+$/.test(path)) {
        const report = one(db, 'SELECT * FROM reports WHERE id=?', Number(path.split('/')[2]));
        if (report) {
          const history = await getDocsFromServer(collection(firestore, 'cadenceReports', `${report.user_id}_${report.date}`, 'history'));
          insertRows(db, 'report_revisions', history.docs.map((h, i) => {
            const data = h.data(), state = data.state;
            return { id: i + 1, report_id: report.id, version: data.version, snapshot: data.legacySnapshot || JSON.stringify({ ...state.report, created_at: state.createdAt?.toDate?.().toISOString() || state.report.created_at, updated_at: state.changedAt?.toDate?.().toISOString() || state.report.updated_at, submitted_at: state.submittedAt?.toDate?.().toISOString() || null, first_submitted_at: state.firstSubmittedAt?.toDate?.().toISOString() || null, activities: state.activities, files: Object.values(state.files) }), actor_id: [...loaded.profiles.values()].find(p => p.uid === data.actorUid)?.row.id || report.user_id, created_at: data.createdAt?.toDate?.().toISOString() || report.updated_at };
          }));
        }
      }
      if (path.includes('/upload-data') && new URL(path, 'https://cadence.local').searchParams.get('metadata') !== '1') {
        const url = new URL(path, 'https://cadence.local');
        let files = all(db, 'SELECT f.* FROM report_files f JOIN reports r ON r.id=f.report_id WHERE r.date BETWEEN ? AND ?', url.searchParams.get('start') || '0001-01-01', url.searchParams.get('end') || '9999-12-31');
        const match = /^\/reports\/(\d+)\//.exec(path);
        if (match) files = files.filter(f => f.report_id === Number(match[1]));
        else { if (user.access !== 'admin') throw Error('Administrator access required.'); files = files.filter(f => !['draft', 'correction_requested'].includes(one(db, 'SELECT status FROM reports WHERE id=?', f.report_id)!.status)); }
        const selected = (url.searchParams.get('files') || url.searchParams.get('file') || '').split(',').filter(Boolean);
        if (selected.length) files = files.filter(f => selected.includes(f.id));
        if (url.searchParams.get('user')) files = files.filter(f => String(f.user_id) === url.searchParams.get('user'));
        await loadParsedRows(loaded, files);
      }
      if (/^\/users\/\d+\/password$/.test(path)) {
        if (user.access !== 'admin') throw Error('Administrator access required.');
        const target = one(db, 'SELECT email,deleted_at FROM users WHERE id=?', Number(path.split('/')[2]));
        if (!target) throw Error('Employee not found.');
        if (target.deleted_at) throw Error('This employee has been deleted from the team.');
        await sendPasswordResetEmail(auth, target.email); return { ok: true };
      }
      if (method === 'PUT' && /^\/users\/\d+$/.test(path)) {
        const previous = one(db, 'SELECT email FROM users WHERE id=?', Number(path.split('/')[2]));
        if (previous && previous.email.toLowerCase() !== body.email.toLowerCase()) throw Error('Login email changes require the Firebase Authentication console.');
      }
      if (path === '/users' && method === 'POST') {
        if (user.access !== 'admin') throw Error('Administrator access required.');
        profile.parse(body);
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) throw Error('Use an initial password with 12 to 128 characters.');
        if (one(db, 'SELECT id FROM users WHERE lower(email)=lower(?) OR employee_code=?', body.email, body.employee_code)) throw Error('This email or employee code already exists.');
        secondary = initializeApp(firebaseConfig, `invite-${crypto.randomUUID()}`);
        const secondAuth = getAuth(secondary);
        if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === '1') connectAuthEmulator(secondAuth, 'http://127.0.0.1:9098', { disableWarnings: true });
        await setPersistence(secondAuth, inMemoryPersistence);
        created = await createUserWithEmailAndPassword(secondAuth, body.email, body.password);
      }
      const router = new ClientRouter(); registerReportingRoutes(router, db);
      const result = await router.invoke(path, method, user, body);
      if (method !== 'GET') await commitWorkspace(loaded, created ? { newProfile: { uid: created.user.uid, id: result.id } } : {});
      created = undefined;
      return result;
    } catch (e) {
      if (created) await deleteUser(created.user).catch(() => {});
      throw e;
    } finally { db.close(); if (secondary) await deleteApp(secondary); }
  } catch (e) { throw friendly(e); }
}
export async function firebaseUpload(path: string, file: File) {
  const loaded = await loadWorkspace();
  try {
    const match = /^\/reports\/(\d+)\/files$/.exec(path);
    if (!match) throw Error('Invalid upload destination.');
    return await uploadFile(loaded, Number(match[1]), file);
  } catch (e) { throw friendly(e); }
  finally { loaded.db.close(); }
}
export async function recordSignInEvent() {
  // Firebase Authentication maintains sign-in metadata. The workspace log records authorized changes.
  const batch = writeBatch(firestore);
  batch.set(doc(collection(firestore, 'cadenceAudit')), { actorUid: auth.currentUser!.uid, actor_id: null, action: 'auth.login', entity: 'authentication', entity_id: auth.currentUser!.uid, before_json: null, after_json: null, created_at: new Date().toISOString(), recordedAt: serverTimestamp() });
  await batch.commit();
}
