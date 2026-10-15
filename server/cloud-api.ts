import serverless from 'serverless-http';
import type { Request } from 'express';
import { createApp } from './app.js';
import type { DB } from './db.js';
import type { AttachmentStore } from './attachments.js';
import { runJobs } from './scheduler.js';

export type ApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
};

/** Buffer responses so a successful HTTP result can only follow a durable Firestore commit. */
export async function invokeApi(db: DB, event: object, attachments: AttachmentStore): Promise<ApiResult> {
  const app = createApp(db, {
    attachments,
    sessionCookie: '__session',
    allowedOrigins: (process.env.APP_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    jobs: () => runJobs(db, new Date(), { sendEmail: false })
  });
  return await serverless(app, { binary: true })(event, {}) as ApiResult;
}

export function cloudEvent(req: Request & { rawBody?: Buffer }) {
  const url = new URL(req.originalUrl || req.url, 'https://cadence-53781.web.app');
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
  // The body has already been parsed by the Functions runtime. Reconstruct its raw bytes.
  const body = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ? JSON.stringify(req.body) : ''));
  delete headers['transfer-encoding'];
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  headers['content-length'] = String(body.length);
  return {
    version: '2.0', rawPath: url.pathname, rawQueryString: url.search.slice(1), headers,
    body: body.toString('base64'), isBase64Encoded: true,
    requestContext: { http: { method: req.method, sourceIp: req.ip || req.socket.remoteAddress || 'unknown' } }
  };
}
