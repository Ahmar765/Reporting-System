import { firebaseClients } from './firebase-client.mjs';
const { projectId, client, firestore } = firebaseClients();
try {
  const request = async (method, url, data) => (await client.request({ method, url, ...(data ? { data } : {}) })).data;
  const billing = await request('GET', `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`);
  if (billing.billingEnabled) throw Error('Expected the no-billing project. Review the project configuration.');
  for (const name of ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com']) {
    const url = `https://serviceusage.googleapis.com/v1/projects/484887934906/services/${name}`;
    const service = await request('GET', url);
    if (service.state !== 'ENABLED') {
      const op = await request('POST', url + ':enable', {});
      if (op.name && !op.done) for (let i = 0; i < 60; i++) {
        const state = await request('GET', 'https://serviceusage.googleapis.com/v1/' + op.name);
        if (state.error) throw Error(state.error.message);
        if (state.done) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  let config;
  try { config = await request('GET', url); }
  catch (error) {
    if (/CONFIGURATION_NOT_FOUND/.test(error.response?.data?.error?.message || error.message)) throw Error('Initialize Authentication with Get started in the Firebase console, then rerun this helper.');
    throw error;
  }
  if (process.argv.includes('--apply')) {
    const authorizedDomains = [...new Set([...(config.authorizedDomains || []), `${projectId}.firebaseapp.com`, `${projectId}.web.app`])];
    await request('PATCH', url + '?updateMask=signIn.email,authorizedDomains', { signIn: { email: { enabled: true, passwordRequired: true } }, authorizedDomains });
    console.log('Firebase email/password authentication enabled. Billing remains disabled.');
  } else console.log(JSON.stringify({ emailPasswordEnabled: config.signIn?.email?.enabled === true, authorizedDomains: config.authorizedDomains, billingEnabled: false }));
} catch (error) {
  console.error(error.response?.data?.error?.message || error.message || 'Authentication setup failed.');
  process.exitCode = 1;
} finally { await firestore.terminate(); }
