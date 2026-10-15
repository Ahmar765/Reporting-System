import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreDatabase } from './firestore-store.js';
import { FirestoreAttachments } from './firestore-attachments.js';
import { createHostedApp } from './hosted-app.js';
import { runJobs } from './scheduler.js';

process.env.NODE_ENV = 'production';
process.env.APP_ORIGIN ||= process.env.RENDER_EXTERNAL_URL;
if (!process.env.APP_ORIGIN?.startsWith('https://')) throw Error('Configure an HTTPS APP_ORIGIN.');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw Error('Configure the private FIREBASE_SERVICE_ACCOUNT environment secret.');
const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (credentials.project_id !== 'cadence-53781') throw Error('Unexpected Firebase service-account project.');
initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
const firestore = getFirestore();
const database = new FirestoreDatabase(firestore);
const app = createHostedApp(database, () => new FirestoreAttachments(firestore));
app.use(express.static(resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
const port = Number(process.env.PORT || 10000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log('Cadence listening on port ' + port + ' with Firestore persistence.'));
let jobsRunning = false;
const tick = async () => {
  if (jobsRunning) return;
  jobsRunning = true;
  try {
    // Free hosts sleep while idle. Catch up on reminders when the process is awake.
    await database.run(db => runJobs(db, new Date(), { sendEmail: false }));
  } catch { console.error('Reminder job could not reach the database.'); }
  finally { jobsRunning = false; }
};
const timer = setInterval(() => { void tick(); }, 60000);
timer.unref();
void tick();
const shutdown = () => {
  clearInterval(timer);
  server.close(() => { void firestore.terminate().finally(() => process.exit(0)); });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
