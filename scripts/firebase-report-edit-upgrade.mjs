import { firebaseClients } from './firebase-client.mjs';
const { projectId, account, firestore } = firebaseClients();
let upgraded = 0;
try {
  const reports = await firestore.collection('cadenceReports').get();
  for (const report of reports.docs) {
    const changed = await firestore.runTransaction(async tx => {
      const current = await tx.get(report.ref);
      if (!current.exists) return false;
      const data = current.data();
      const patch = {};
      for (const field of ['employee_edit_count', 'employee_edit_open']) {
        if (data.report[field] === undefined) patch['report.' + field] = 0;
        else if (![0, 1].includes(data.report[field])) throw Error('Unexpected edit allowance. Upgrade stopped without resetting it.');
      }
      if (!Object.keys(patch).length) return false;
      tx.update(report.ref, { ...patch, revision: data.revision + 1 });
      return true;
    });
    if (changed) upgraded++;
  }
  console.log(JSON.stringify({ projectId, account, reports: reports.size, upgraded }));
} finally { await firestore.terminate(); }
