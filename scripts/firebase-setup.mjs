import { firebaseClients } from './firebase-client.mjs';
import { access, writeFile } from 'node:fs/promises';
const { projectId, client, firestore } = firebaseClients();
const request = async (method, url, data) => (await client.request({ method, url, ...(data ? { data } : {}) })).data;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const service = 'projects/484887934906/services/firestore.googleapis.com';
const enabled = await request('GET', 'https://serviceusage.googleapis.com/v1/' + service);
if (enabled.state !== 'ENABLED') {
  const op = await request('POST', 'https://serviceusage.googleapis.com/v1/' + service + ':enable', {});
  while (!op.done && op.name) {
    await wait(2000);
    const status = await request('GET', 'https://serviceusage.googleapis.com/v1/' + op.name);
    if (status.error) throw Error(status.error.message);
    if (status.done) break;
  }
}
const databases = await request('GET', 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases');
if (!(databases.databases || []).some(db => db.name.endsWith('/(default)'))) {
  const op = await request('POST', 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases?databaseId=(default)', {
    locationId: 'us-central1', type: 'FIRESTORE_NATIVE', concurrencyMode: 'PESSIMISTIC', deleteProtectionState: 'DELETE_PROTECTION_ENABLED'
  });
  if (op.name) {
    for (;;) {
      await wait(2000);
      const status = await request('GET', 'https://firestore.googleapis.com/v1/' + op.name);
      if (status.error) throw Error(status.error.message);
      if (status.done) break;
    }
  }
}
console.log('The default Firestore database is ready. Billing was not enabled.');
if (process.argv.includes('--runtime-key')) {
  const keyPath = '.env.render-secret';
  let exists = true;
  try { await access(keyPath); } catch { exists = false; }
  if (exists) console.log('An ignored runtime credential file already exists; no additional key was created.');
  else {
    const email = 'cadence-runtime@' + projectId + '.iam.gserviceaccount.com';
    const accountName = 'projects/' + projectId + '/serviceAccounts/' + email;
    try { await request('GET', 'https://iam.googleapis.com/v1/' + accountName); }
    catch (error) {
      if (error.response?.status !== 404) throw error;
      await request('POST', 'https://iam.googleapis.com/v1/projects/' + projectId + '/serviceAccounts', { accountId: 'cadence-runtime', serviceAccount: { displayName: 'Cadence reporting runtime' } });
    }
    const policyUrl = 'https://cloudresourcemanager.googleapis.com/v1/projects/' + projectId;
    const policy = await request('POST', policyUrl + ':getIamPolicy', {});
    policy.bindings ||= [];
    let binding = policy.bindings.find(b => b.role === 'roles/datastore.user' && !b.condition);
    if (!binding) { binding = { role: 'roles/datastore.user', members: [] }; policy.bindings.push(binding); }
    const member = 'serviceAccount:' + email;
    if (!binding.members.includes(member)) {
      binding.members.push(member);
      await request('POST', policyUrl + ':setIamPolicy', { policy });
    }
    const key = await request('POST', 'https://iam.googleapis.com/v1/' + accountName + '/keys', { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE' });
    const json = JSON.parse(Buffer.from(key.privateKeyData, 'base64').toString('utf8'));
    await writeFile(keyPath, 'FIREBASE_SERVICE_ACCOUNT=' + JSON.stringify(json) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Created a database-only runtime identity; its secret is stored only in the ignored .env.render-secret file.');
  }
}
await firestore.terminate();
