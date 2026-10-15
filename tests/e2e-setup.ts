import express from 'express';
import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { all } from '../server/db.js';
import { fixture, assign } from './helpers.js';
import { createApp } from '../server/app.js';
export default async function setup() {
  process.env.APP_ORIGIN = 'http://127.0.0.1:3111';
  const db = await fixture();
  assign(db);
  const app = createApp(db);
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  const server = app.listen(3111, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  return async () => {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    for (const file of all(db, 'SELECT storage_name FROM report_files')) await unlink(resolve('data/uploads', file.storage_name)).catch(() => {});
    db.close();
  };
}
