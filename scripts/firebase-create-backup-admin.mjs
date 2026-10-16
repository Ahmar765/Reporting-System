import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from '@google-cloud/firestore';
import { firebaseClients } from './firebase-client.mjs';

const inputIndex = process.argv.indexOf('--input');
if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw Error('Provide a private JSON file with email, name, and password using --input.');
const input = JSON.parse(readFileSync(process.argv[inputIndex + 1], 'utf8'));
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email || '') || typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 120 || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw Error('Use a valid email, display name, and password with 12 to 128 characters.');
const { projectId, account, client, firestore } = firebaseClients();
const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: (await client.getAccessToken()).token, expires_in: 3600 }) } }, 'backup-administrator');
const auth = getAuth(app);
let createdUid;
let committed = false;
try {
  const existing = await auth.getUserByEmail(input.email).catch(error => { if (error.code === 'auth/user-not-found') return null; throw error; });
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', projectId, account, email: input.email, name: input.name.trim(), alreadyExists: !!existing, action: 'Create a separate visible workspace administrator; existing accounts remain unchanged.' }));
  } else {
    if (existing) throw Error('That email already has a Firebase account. No password or access was changed.');
    const user = await auth.createUser({ email: input.email, displayName: input.name.trim(), password: input.password, disabled: false });
    createdUid = user.uid;
    // Verify the supplied credential without logging passwords, tokens, or request objects.
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyAXKAm7mF6v8y4JJMyPkGYuK9_UK5oxLFg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.email, password: input.password, returnSecureToken: true }) });
    const login = await response.json();
    if (!response.ok || login.localId !== user.uid) throw Error('Backup sign-in verification failed before workspace access was granted.');
    const id = await firestore.runTransaction(async tx => {
      const configRef = firestore.doc('cadenceConfig/main');
      const [config, members] = await Promise.all([tx.get(configRef), tx.get(firestore.collection('cadenceProfiles'))]);
      if (!config.exists) throw Error('Workspace configuration is missing.');
      if (members.docs.some(member => member.get('row.email')?.toLowerCase() === input.email.toLowerCase())) throw Error('This workspace email already exists.');
      const id = Math.max(0, ...members.docs.map(member => member.get('row.id'))) + 1;
      if (id >= 90000000) throw Error('Workspace ID range exhausted.');
      const role = config.get('tables.roles').find(role => role.name === 'Other / Custom Role') || config.get('tables.roles')[0];
      if (!role) throw Error('Create a workspace role before creating the backup administrator.');
      const stamp = new Date().toISOString();
      const row = { id, email: input.email.toLowerCase(), name: input.name.trim(), employee_code: 'BACKUP-ADMIN-' + id, access: 'admin', role_id: role.id, active: 1, joining_date: stamp.slice(0, 10), timezone: 'Asia/Karachi', workdays: '[1,2,3,4,5]', deadline: '22:00', notifications: 1, email_notifications: 0, created_at: stamp };
      tx.create(firestore.doc('cadenceProfiles/' + user.uid), { revision: 0, uid: user.uid, row, category_ids: [], tables: { assignments: [], leave_days: [], profile_versions: [], reflections: [], overrides: [] }, actorUid: 'owner-cli', changedAt: FieldValue.serverTimestamp() });
      tx.update(configRef, { revision: config.get('revision') + 1, reviewers: [...config.get('reviewers'), { id, name: row.name, role_id: role.id }], actorUid: 'owner-cli', changedAt: FieldValue.serverTimestamp() });
      tx.create(firestore.collection('cadenceAudit').doc(), { actorUid: 'owner-cli', actor_id: null, action: 'admin.backup_created', entity: 'user', entity_id: String(id), before_json: null, after_json: JSON.stringify({ email: row.email, name: row.name, access: row.access, provisionedBy: account }), created_at: stamp, recordedAt: FieldValue.serverTimestamp() });
      return id;
    });
    committed = true;
    const profile = await firestore.doc('cadenceProfiles/' + user.uid).get();
    if (profile.get('row.access') !== 'admin' || profile.get('row.active') !== 1) throw Error('Backup membership verification failed.');
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/`;
    const checks = await Promise.all(['cadenceConfig/main', 'cadenceProfiles/' + user.uid, 'cadenceProfiles?pageSize=1'].map(path => fetch(base + path, { headers: { Authorization: 'Bearer ' + login.idToken } })));
    if (checks.some(response => response.status !== 200)) throw Error('The account was created but its workspace access check failed. Inspect membership before retrying.');
    console.log(JSON.stringify({ projectId, email: input.email, name: input.name.trim(), id, access: 'admin', signInVerified: true, membershipVerified: true, workspaceAccessVerified: true }));
  }
} finally {
  if (createdUid && !committed) await auth.deleteUser(createdUid);
  await deleteApp(app);
  await firestore.terminate();
}
