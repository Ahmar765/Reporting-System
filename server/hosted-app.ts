import express from 'express';
import { cloudEvent, invokeApi } from './cloud-api.js';
import { PersistenceError, type FirestoreDatabase } from './firestore-store.js';
import type { StagedAttachments } from './firestore-attachments.js';
import { securityHeaders, rateLimit } from './security.js';

export function createHostedApp(database: Pick<FirestoreDatabase, 'run' | 'ready'>, createAttachments: () => StagedAttachments) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders());
  app.get('/api/health', async (_req, res) => {
    try {
      if (!(await database.ready())) throw Error('Database not initialized.');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'ok', database: 'firestore', attachments: 'firestore' });
    } catch {
      res.status(503).json({ error: 'Database is not ready.' });
    }
  });
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500 }));
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.originalUrl.split('?')[0] !== '/api/auth/login' && !/(?:^|;\s*)__session=/.test(req.headers.cookie || '')) {
      res.status(401).json({ error: 'Please sign in.' });
      return;
    }
    next();
  });
  app.use('/api', express.raw({ type: () => true, limit: '5mb' }));
  app.use('/api', async (req, res) => {
    const attachments = createAttachments();
    try {
      const response = await database.run(async db => {
        const result = await invokeApi(db, cloudEvent(req), attachments);
        if (result.statusCode >= 500) throw new PersistenceError('Unable to complete this request.');
        await attachments.prepare();
        return result;
      });
      await attachments.finish();
      for (const [key, value] of Object.entries(response.headers)) {
        if (!['transfer-encoding', 'content-length', 'connection'].includes(key.toLowerCase())) res.setHeader(key, value);
      }
      if (response.cookies?.length) res.setHeader('Set-Cookie', response.cookies);
      res.status(response.statusCode).send(Buffer.from(response.body, response.isBase64Encoded ? 'base64' : 'utf8'));
    } catch (error) {
      await attachments.rollback();
      const busy = error && typeof error === 'object' && 'code' in error && [4, 10].includes(Number(error.code));
      console.error('Cloud request failed:', error instanceof Error ? error.name : 'Unknown');
      if (busy) res.setHeader('Retry-After', '2');
      res.status(error instanceof PersistenceError ? error.status : busy ? 409 : 503).json({
        error: error instanceof PersistenceError ? error.message : busy ? 'Another update is being saved. Try again.' : 'The database is temporarily unavailable. Please try again.'
      });
    }
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: error?.type === 'entity.too.large' ? 'Files must be 5 MB or smaller.' : 'Invalid request.' });
  });
  return app;
}
