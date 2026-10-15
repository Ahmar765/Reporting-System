import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { openDb, migrate } from './db.js';
import { createApp } from './app.js';
import { runJobs } from './scheduler.js';
const db = openDb();
migrate(db);
const app = createApp(db);
const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' || process.argv.includes('--static')) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN?.startsWith('https://')) throw Error('Production requires an HTTPS APP_ORIGIN.');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const {
    createServer
  } = await import('vite');
  const vite = await createServer({
    configLoader: 'runner',
    server: {
      middlewareMode: true
    },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () => console.log('Cadence listening at http://localhost:' + port));
const interval = setInterval(() => {
  void runJobs(db).catch(() => console.error('Reminder job failed.'));
}, 60000);
interval.unref();
void runJobs(db).catch(() => console.error('Reminder job failed.'));
const shutdown = () => {
  clearInterval(interval);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
