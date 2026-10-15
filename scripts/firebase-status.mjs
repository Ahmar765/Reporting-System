import { firebaseClients } from './firebase-client.mjs';
const { projectId, account, client, firestore } = firebaseClients();
console.log(JSON.stringify({ projectId, account }));
const urls = {
  billing: 'https://cloudbilling.googleapis.com/v1/projects/' + projectId + '/billingInfo',
  databases: 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases'
};
await Promise.all(Object.entries(urls).map(async ([name, url]) => {
  try {
    const { data } = await client.request({ url });
    const summary = name === 'billing' ? { billingEnabled: data.billingEnabled } : name === 'databases' ? { databases: data.databases?.map(db => ({ name: db.name, location: db.locationId, type: db.type })) || [] } : name === 'bucket' ? { name: data.name, location: data.location } : { plan: data.billingPlan };
    console.log(JSON.stringify({ check: name, ...summary }));
  } catch (error) {
    console.log(JSON.stringify({ check: name, status: error.response?.status, message: error.response?.data?.error?.message || 'Check failed' }));
  }
}));
await firestore.terminate();
