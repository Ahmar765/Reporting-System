import express from 'express';
import { randomUUID } from 'node:crypto';
import { localAttachments, type AttachmentStore } from './attachments.js';
import { parseUploadedTable } from './upload-data.js';
import { securityHeaders, rateLimit } from './security.js';
import { z, ZodError } from 'zod/v4';
import { DateTime } from './calendar.js';
import { all, one, exec, now, transaction, audit, type DB, type Row } from './db.js';
import { createSession, digest, verifyPassword, hashPassword, publicUser } from './auth.js';
import { date, id, profile, reportInput, assignmentInput, scoreInput, clock, zone, text } from './validation.js';
import { settings, localToday, isWorking, summary, days, reportingStatus } from './domain.js';
import { runJobs } from './scheduler.js';
import { download } from './exports.js';
import { notificationSqlFilter } from './notification-policy.js';
declare module 'express-serve-static-core' {
  interface Request {
    user: Row;
    csrf: string;
    sessionHash: string;
  }
}
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export function createApp(db: DB, options: { attachments?: AttachmentStore; sessionCookie?: string; allowedOrigins?: string[]; jobs?: () => Promise<unknown> } = {}) {
  const attachments = options.attachments || localAttachments();
  const sessionCookie = options.sessionCookie || 'bd_session';
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(securityHeaders());
  app.use(express.json({
    limit: '1mb'
  }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const allowed = process.env.APP_ORIGIN || 'http://localhost:3000';
      if (![allowed, ...(options.allowedOrigins || []), ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'] : [])].includes(req.headers.origin)) return next(new HttpError(403, 'Origin not allowed'));
    }
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many attempts. Try again later.'
    }
  });
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok'
  }));
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const body = z.object({
      email: z.email().max(200),
      password: z.string().min(1).max(128)
    }).parse(req.body);
    const key = digest((req.ip || 'unknown') + ':' + body.email.toLowerCase());
    const attempt = one(db, 'SELECT * FROM login_attempts WHERE key=?', key);
    if (attempt && attempt.count >= 10 && Date.now() - Date.parse(attempt.last_at) < 900000) fail(429, 'Too many attempts. Try again later.');
    const user = one(db, 'SELECT u.*,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=?', body.email);
    // Always run a password KDF, including unknown accounts.
    const valid = await verifyPassword(body.password, user?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64));
    if (!user || !user.active || !valid) {
      exec(db, 'INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN last_at<? THEN 1 ELSE count+1 END,last_at=excluded.last_at', key, now(), new Date(Date.now() - 900000).toISOString());
      audit(db, null, 'auth.failed', 'authentication', key);
      fail(401, 'Email or password is incorrect.');
    }
    exec(db, 'DELETE FROM login_attempts WHERE key=?', key);
    const session = createSession(db, user.id);
    res.cookie(sessionCookie, session.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 3600000,
      path: '/'
    });
    audit(db, user.id, 'auth.login', 'user', user.id);
    res.json({
      user: publicUser(user),
      csrf: session.csrf
    });
  });
  app.use('/api', (req, _res, next) => {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
    const hash = token ? digest(token) : '';
    const s = one(db, 'SELECT s.*,u.*,r.name AS role_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1', hash, now());
    if (!s) return next(new HttpError(401, 'Please sign in.'));
    req.user = s;
    req.csrf = s.csrf;
    req.sessionHash = hash;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== s.csrf) return next(new HttpError(403, 'Invalid request token. Refresh and try again.'));
    next();
  });
  const admin = (req: express.Request) => {
    if (req.user.access !== 'admin') fail(403, 'Administrator access required.');
  };
  const scope = (req: express.Request, value: unknown) => {
    const userId = id.parse(value);
    if (req.user.access !== 'admin' && req.user.id !== userId) fail(403, 'You cannot access this employee.');
    return userId;
  };
  const getUser = (userId: number) => one(db, 'SELECT u.*,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', userId) || fail(404, 'Employee not found.');
  const getReport = (req: express.Request, value: unknown) => {
    const r = one(db, 'SELECT * FROM reports WHERE id=?', id.parse(value)) || fail(404, 'Report not found.');
    scope(req, r.user_id);
    return r;
  };
  const activitiesFor = (reportId: number) => all(db, 'SELECT * FROM activities WHERE report_id=?', reportId).map(a => ({
    ...a,
    links: all(db, 'SELECT url FROM activity_links WHERE activity_id=? ORDER BY id', a.id).map(x => x.url)
  }));
  const fileMetadata = (reportId: number) => all(db, 'SELECT id,report_id,user_id,original_name,extension,mime_type,byte_size,sheet_name,columns_json,row_count,created_at FROM report_files WHERE report_id=? ORDER BY created_at,id', reportId).map(f => ({
    ...f,
    columns: JSON.parse(f.columns_json)
  }));
  const range = (req: express.Request) => {
    const today = localToday(settings(db).timezone);
    const start = date.parse(req.query.start || today.slice(0, 7) + '-01');
    const end = date.parse(req.query.end || today);
    days(start, end);
    return {
      start,
      end
    };
  };
  app.get('/api/auth/me', (req, res) => res.json({
    user: publicUser(req.user),
    csrf: req.csrf
  }));
  app.post('/api/auth/logout', (req, res) => {
    exec(db, 'DELETE FROM sessions WHERE token_hash=?', req.sessionHash);
    audit(db, req.user.id, 'auth.logout', 'user', req.user.id);
    res.clearCookie(sessionCookie, {
      path: '/'
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/auth/password', authLimit, async (req, res) => {
    const b = z.object({
      current: z.string().max(128),
      password: z.string().min(12).max(128)
    }).parse(req.body);
    if (!(await verifyPassword(b.current, req.user.password_hash))) fail(400, 'Current password is incorrect.');
    const hash = await hashPassword(b.password);
    transaction(db, () => {
      exec(db, 'UPDATE users SET password_hash=? WHERE id=?', hash, req.user.id);
      exec(db, 'DELETE FROM sessions WHERE user_id=?', req.user.id);
      audit(db, req.user.id, 'auth.password_changed', 'user', req.user.id);
    });
    res.clearCookie(sessionCookie, {
      path: '/'
    });
    res.json({
      ok: true
    });
  });
  app.get('/api/bootstrap', (req, res) => {
    const userIds = req.user.access === 'admin' ? all(db, 'SELECT id FROM users').map(x => x.id) : [req.user.id];
    res.json({
      user: publicUser(req.user),
      roles: all(db, 'SELECT * FROM roles'),
      categories: req.user.access === 'admin' ? all(db, 'SELECT * FROM categories') : all(db, 'SELECT c.* FROM categories c JOIN user_categories uc ON uc.category_id=c.id WHERE uc.user_id=?', req.user.id),
      users: userIds.map(n => {
        const u = publicUser(getUser(n));
        return {
          ...u,
          category_ids: all(db, 'SELECT category_id FROM user_categories WHERE user_id=?', n).map(c => c.category_id)
        };
      }),
      kpis: req.user.access === 'admin' ? all(db, 'SELECT k.*,c.name AS category FROM kpis k JOIN categories c ON c.id=k.category_id') : all(db, 'SELECT DISTINCT k.*,c.name AS category FROM kpis k JOIN categories c ON c.id=k.category_id JOIN assignments a ON a.kpi_id=k.id WHERE a.user_id=?', req.user.id),
      assignments: req.user.access === 'admin' ? all(db, 'SELECT * FROM assignments') : all(db, 'SELECT * FROM assignments WHERE user_id=?', req.user.id),
      settings: settings(db),
      holidays: all(db, 'SELECT * FROM holidays ORDER BY date'),
      leave: req.user.access === 'admin' ? all(db, 'SELECT * FROM leave_days ORDER BY start_date') : all(db, 'SELECT * FROM leave_days WHERE user_id=?', req.user.id),
      scoring: req.user.access === 'admin' ? all(db, 'SELECT * FROM scoring_configs ORDER BY id DESC') : [],
      unread: one(db, 'SELECT count(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL' + notificationSqlFilter(req.user.access), req.user.id)!.n
    });
  });
  app.post('/api/users', async (req, res) => {
    admin(req);
    const b = profile.extend({
      password: z.string().min(12).max(128)
    }).parse(req.body);
    const hash = await hashPassword(b.password);
    const uid = transaction(db, () => {
      const result = exec(db, 'INSERT INTO users(email,password_hash,name,employee_code,access,role_id,joining_date,timezone,workdays,deadline,notifications,email_notifications,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', b.email, hash, b.name, b.employee_code, b.access, b.role_id, b.joining_date, b.timezone, JSON.stringify([...new Set(b.workdays)]), b.deadline, +b.notifications, +b.email_notifications, now());
      const n = Number(result.lastInsertRowid);
      exec(db, 'INSERT INTO profile_versions(user_id,effective_date,snapshot,created_at) VALUES(?,?,?,?)', n, '0001-01-01', JSON.stringify({
        role_id: b.role_id,
        workdays: JSON.stringify(b.workdays),
        timezone: b.timezone,
        deadline: b.deadline,
        joining_date: b.joining_date
      }), now());
      for (const c of new Set(b.category_ids)) exec(db, 'INSERT INTO user_categories VALUES(?,?)', n, c);
      audit(db, req.user.id, 'employee.created', 'user', n, null, {
        ...b,
        password: undefined
      });
      return n;
    });
    res.status(201).json({
      id: uid
    });
  });
  app.put('/api/users/:id', (req, res) => {
    admin(req);
    const uid = id.parse(req.params.id);
    const before = getUser(uid);
    const b = profile.parse(req.body);
    if (uid === req.user.id && b.access !== 'admin') fail(400, 'You cannot remove your own administrator access.');
    transaction(db, () => {
      const snapshot = (u: Row) => JSON.stringify({
        role_id: u.role_id,
        workdays: typeof u.workdays === 'string' ? u.workdays : JSON.stringify(u.workdays),
        timezone: u.timezone,
        deadline: u.deadline,
        joining_date: u.joining_date
      });
      exec(db, 'INSERT OR IGNORE INTO profile_versions(user_id,effective_date,snapshot,created_at) VALUES(?,?,?,?)', uid, '0001-01-01', snapshot(before), now());
      exec(db, 'INSERT INTO profile_versions(user_id,effective_date,snapshot,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,effective_date) DO UPDATE SET snapshot=excluded.snapshot,created_at=excluded.created_at', uid, localToday(settings(db).timezone), snapshot(b), now());
      exec(db, 'UPDATE users SET name=?,email=?,employee_code=?,access=?,role_id=?,joining_date=?,timezone=?,workdays=?,deadline=?,notifications=?,email_notifications=? WHERE id=?', b.name, b.email, b.employee_code, b.access, b.role_id, b.joining_date, b.timezone, JSON.stringify([...new Set(b.workdays)]), b.deadline, +b.notifications, +b.email_notifications, uid);
      exec(db, 'DELETE FROM user_categories WHERE user_id=?', uid);
      for (const c of new Set(b.category_ids)) exec(db, 'INSERT INTO user_categories VALUES(?,?)', uid, c);
      exec(db, 'DELETE FROM sessions WHERE user_id=? AND token_hash<>?', uid, req.sessionHash);
      audit(db, req.user.id, 'employee.updated', 'user', uid, publicUser(before), b);
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/users/:id/status', (req, res) => {
    admin(req);
    const uid = id.parse(req.params.id);
    getUser(uid);
    const b = z.object({
      active: z.boolean()
    }).parse(req.body);
    if (uid === req.user.id) fail(400, 'You cannot deactivate yourself.');
    transaction(db, () => {
      exec(db, 'UPDATE users SET active=? WHERE id=?', +b.active, uid);
      exec(db, 'DELETE FROM sessions WHERE user_id=?', uid);
      audit(db, req.user.id, 'employee.status', 'user', uid, null, b);
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/users/:id/password', authLimit, async (req, res) => {
    admin(req);
    const uid = id.parse(req.params.id);
    getUser(uid);
    const b = z.object({
      password: z.string().min(12).max(128)
    }).parse(req.body);
    const hash = await hashPassword(b.password);
    transaction(db, () => {
      exec(db, 'UPDATE users SET password_hash=? WHERE id=?', hash, uid);
      exec(db, 'DELETE FROM sessions WHERE user_id=?', uid);
      audit(db, req.user.id, 'employee.password_reset', 'user', uid);
    });
    res.json({
      ok: true
    });
  });
  for (const table of ['roles', 'categories'] as const) app.post('/api/' + table, (req, res) => {
    admin(req);
    const b = z.object({
      name: z.string().min(2).max(120)
    }).parse(req.body);
    const r = exec(db, 'INSERT INTO ' + table + '(name) VALUES(?)', b.name);
    audit(db, req.user.id, table + '.created', table, Number(r.lastInsertRowid), null, b);
    res.status(201).json({
      id: Number(r.lastInsertRowid)
    });
  });
  app.post('/api/kpis', (req, res) => {
    admin(req);
    const b = z.object({
      name: z.string().min(2).max(120),
      description: text,
      category_id: id,
      unit: z.string().min(1).max(50),
      kind: z.enum(['achievement', 'quality', 'impact']),
      aggregation: z.enum(['sum', 'average']).default('sum')
    }).parse(req.body);
    const r = exec(db, 'INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) VALUES(?,?,?,?,?,?)', b.name, b.description, b.category_id, b.unit, b.kind, b.aggregation);
    audit(db, req.user.id, 'kpi.created', 'kpi', Number(r.lastInsertRowid), null, b);
    res.status(201).json({
      id: Number(r.lastInsertRowid)
    });
  });
  app.post('/api/kpis/:id/status', (req, res) => {
    admin(req);
    const kid = id.parse(req.params.id);
    const b = z.object({
      active: z.boolean()
    }).parse(req.body);
    const before = one(db, 'SELECT * FROM kpis WHERE id=?', kid) || fail(404, 'KPI not found.');
    transaction(db, () => {
      exec(db, 'UPDATE kpis SET active=? WHERE id=?', +b.active, kid);
      audit(db, req.user.id, 'kpi.status', 'kpi', kid, before, b);
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/assignments', (req, res) => {
    admin(req);
    const b = assignmentInput.parse(req.body);
    getUser(b.user_id);
    const kpi = one(db, 'SELECT * FROM kpis WHERE id=? AND active=1', b.kpi_id) || fail(400, 'Select an active KPI.');
    const today = localToday(settings(db).timezone);
    if (b.start_date < today) fail(400, 'New targets must start today or later to preserve history.');
    if (one(db, 'SELECT id FROM reports WHERE user_id=? AND date>=? AND status<>?', b.user_id, b.start_date, 'draft')) fail(409, 'A submitted report already exists in this target period.');
    const aid = transaction(db, () => {
      const previous = all(db, 'SELECT * FROM assignments WHERE user_id=? AND kpi_id=? AND (end_date IS NULL OR end_date>=?) AND start_date<=?', b.user_id, b.kpi_id, b.start_date, b.end_date || '9999-12-31');
      for (const a of previous) {
        if (a.start_date >= b.start_date) fail(409, 'Overlapping future target. End or replace it before assigning.');
        const end = DateTime.fromISO(b.start_date).minus({
          days: 1
        }).toISODate()!;
        exec(db, 'UPDATE assignments SET end_date=? WHERE id=?', end, a.id);
        audit(db, req.user.id, 'target.closed', 'assignment', a.id, a, {
          ...a,
          end_date: end
        });
      }
      const r = exec(db, 'INSERT INTO assignments(kpi_id,user_id,target,frequency,start_date,end_date,weight,minimum_quality,created_at) VALUES(?,?,?,?,?,?,?,?,?)', b.kpi_id, b.user_id, b.target, b.frequency, b.start_date, b.end_date, b.weight, b.minimum_quality, now());
      exec(db, 'INSERT OR IGNORE INTO user_categories VALUES(?,?)', b.user_id, kpi.category_id);
      audit(db, req.user.id, 'target.assigned', 'assignment', Number(r.lastInsertRowid), null, b);
      return Number(r.lastInsertRowid);
    });
    res.status(201).json({
      id: aid
    });
  });
  app.post('/api/assignments/:id/end', (req, res) => {
    admin(req);
    const a = one(db, 'SELECT * FROM assignments WHERE id=?', id.parse(req.params.id)) || fail(404, 'Target not found.');
    const b = z.object({
      end_date: date
    }).parse(req.body);
    if (b.end_date < localToday(settings(db).timezone) || b.end_date < a.start_date) fail(400, 'End date must be today or later and after the start.');
    transaction(db, () => {
      exec(db, 'UPDATE assignments SET end_date=? WHERE id=?', b.end_date, a.id);
      audit(db, req.user.id, 'target.ended', 'assignment', a.id, a, b);
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/scoring', (req, res) => {
    admin(req);
    const b = scoreInput.parse(req.body);
    if (b.effective_date <= localToday(settings(db).timezone)) fail(400, 'Score configuration changes must take effect on a future date.');
    const r = exec(db, 'INSERT INTO scoring_configs(user_id,role_id,effective_date,weights,cap,bands,created_at) VALUES(?,?,?,?,?,?,?)', b.user_id, b.role_id, b.effective_date, JSON.stringify(b.weights), b.cap, JSON.stringify(b.bands), now());
    audit(db, req.user.id, 'scoring.configured', 'scoring', Number(r.lastInsertRowid), null, b);
    res.status(201).json({
      ok: true
    });
  });
  app.get('/api/reports', (req, res) => {
    const {
      start,
      end
    } = range(req);
    const uid = req.query.user ? scope(req, req.query.user) : req.user.access === 'admin' ? null : req.user.id;
    const rows = all(db, 'SELECT r.*,u.name,u.employee_code,j.name AS role_name FROM reports r JOIN users u ON u.id=r.user_id JOIN roles j ON j.id=u.role_id WHERE r.date BETWEEN ? AND ?' + (uid ? ' AND r.user_id=?' : '') + ' ORDER BY r.date DESC,r.id DESC', start, end, ...(uid ? [uid] : [])).filter(r => (!req.query.status || r.status === req.query.status || req.query.status === 'late' && reportingStatus(db, getUser(r.user_id), r.date) === 'late') && (!req.query.role || String(getUser(r.user_id).role_id) === req.query.role) && (!req.query.category || one(db, 'SELECT id FROM activities WHERE report_id=? AND category_id=?', r.id, id.parse(req.query.category))));
    const page = z.coerce.number().int().min(1).parse(req.query.page || 1);
    res.json({
      rows: rows.slice((page - 1) * 20, page * 20).map(r => ({
        ...r,
        timeliness: reportingStatus(db, getUser(r.user_id), r.date)
      })),
      total: rows.length,
      page
    });
  });
  app.get('/api/reports/:id', (req, res) => {
    const r = getReport(req, req.params.id);
    res.json({
      ...r,
      activities: activitiesFor(r.id),
      files: fileMetadata(r.id),
      feedback: all(db, 'SELECT f.*,u.name AS actor FROM feedback f JOIN users u ON u.id=f.actor_id WHERE report_id=? ORDER BY f.id DESC', r.id),
      revisions: all(db, 'SELECT id,version,created_at,snapshot FROM report_revisions WHERE report_id=? ORDER BY version DESC', r.id)
    });
  });
  app.get('/api/reports/:id/upload-data', (req, res) => {
    const report = getReport(req, req.params.id);
    const files = all(db, 'SELECT id,original_name,extension,byte_size,sheet_name,row_count,columns_json,created_at FROM report_files WHERE report_id=? ORDER BY created_at,id', report.id).map(f => ({
      ...f,
      columns: JSON.parse(f.columns_json)
    }));
    const records = all(db, 'SELECT fr.file_id,fr.row_number,fr.values_json FROM report_file_rows fr JOIN report_files f ON f.id=fr.file_id WHERE f.report_id=? ORDER BY f.created_at,f.id,fr.row_number LIMIT 10000', report.id);
    const headers = [...new Set(files.flatMap(f => f.columns as string[]))];
    res.json({
      report_id: report.id,
      date: report.date,
      files,
      headers,
      rows: records.map(x => ({
        file_id: x.file_id,
        row_number: x.row_number,
        values: JSON.parse(x.values_json)
      })),
      total: records.length,
      limit: 10000
    });
  });
  app.post('/api/reports', (req, res) => {
    const b = reportInput.parse(req.body);
    const user = req.user;
    const today = localToday(user.timezone);
    if (b.date > today || !isWorking(db, user, b.date)) fail(400, 'Choose a scheduled working date on or before today.');
    if (b.submit && (!b.activities.length || !b.achievements.trim() || !b.next_plan.trim())) fail(400, 'Submission needs an activity, achievements, and a next-day plan.');
    if (b.activities.reduce((s, a) => s + a.minutes, 0) > 1440) fail(400, 'Total time cannot exceed 24 hours.');
    const assigned = all(db, 'SELECT a.*,k.unit,k.category_id FROM assignments a JOIN kpis k ON k.id=a.kpi_id WHERE a.user_id=? AND a.start_date<=? AND (a.end_date IS NULL OR a.end_date>=?)', user.id, b.date, b.date);
    const seen = new Set<number>();
    for (const a of b.activities) {
      if (!one(db, 'SELECT * FROM user_categories WHERE user_id=? AND category_id=?', user.id, a.category_id)) fail(403, 'This category is not assigned to you.');
      if (a.assignment_id) {
        const target = assigned.find(t => t.id === a.assignment_id);
        if (!target || target.category_id !== a.category_id || target.unit !== a.unit) fail(400, 'Activity does not match an assigned target.');
        if (seen.has(a.assignment_id)) fail(400, 'Enter each KPI once per daily report.');
        seen.add(a.assignment_id);
      }
    }
    const result = transaction(db, () => {
      let r = one(db, 'SELECT * FROM reports WHERE user_id=? AND date=?', user.id, b.date);
      if (r && r.version !== b.version) fail(409, 'This report changed. Reopen it before saving.');
      if (!r && b.version !== 0) fail(409, 'Report version is invalid.');
      if (r && !['draft', 'correction_requested'].includes(r.status)) fail(409, 'Submitted reports require an administrator correction request.');
      const before = r ? {
        ...r,
        activities: activitiesFor(r.id),
        files: fileMetadata(r.id)
      } : null;
      const status = b.submit ? r?.status === 'correction_requested' ? 'corrected' : 'submitted' : r?.status === 'correction_requested' ? 'correction_requested' : 'draft';
      const stamp = now();
      const values = [b.achievements, b.blockers, b.missed_reason, b.lessons, b.suggestions, b.next_plan, b.assistance];
      if (!r) {
        const n = exec(db, 'INSERT INTO reports(user_id,date,status,achievements,blockers,missed_reason,lessons,suggestions,next_plan,assistance,created_at,updated_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', user.id, b.date, status, ...values, stamp, stamp, b.submit ? stamp : null);
        r = one(db, 'SELECT * FROM reports WHERE id=?', Number(n.lastInsertRowid))!;
      } else exec(db, 'UPDATE reports SET status=?,achievements=?,blockers=?,missed_reason=?,lessons=?,suggestions=?,next_plan=?,assistance=?,updated_at=?,submitted_at=?,version=version+1 WHERE id=?', status, ...values, stamp, b.submit ? stamp : r.submitted_at, r.id);
      exec(db, 'DELETE FROM activities WHERE report_id=?', r.id);
      for (const a of b.activities) {
        const inserted = exec(db, 'INSERT INTO activities(report_id,category_id,assignment_id,title,description,actual,unit,outcome,status,minutes,evidence,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', r.id, a.category_id, a.assignment_id, a.title, a.description, a.actual, a.unit, a.outcome, a.status, a.minutes, '', a.notes);
        const activityId = Number(inserted.lastInsertRowid);
        for (const url of a.links.length ? a.links : a.evidence ? [a.evidence] : []) exec(db, 'INSERT INTO activity_links(activity_id,url,created_at) VALUES(?,?,?)', activityId, url, stamp);
      }
      if (b.submit) exec(db, 'UPDATE reports SET first_submitted_at=COALESCE(first_submitted_at,?) WHERE id=?', stamp, r.id);
      const after: Row = {
        ...one(db, 'SELECT * FROM reports WHERE id=?', r.id),
        activities: activitiesFor(r.id),
        files: fileMetadata(r.id)
      };
      exec(db, 'INSERT INTO report_revisions(report_id,version,snapshot,actor_id,created_at) VALUES(?,?,?,?,?)', r.id, after.version, JSON.stringify(after), user.id, stamp);
      audit(db, user.id, b.submit ? 'report.' + status : 'report.saved', 'report', r.id, before, after);
      return after;
    });
    res.json(result);
  });
  const allowedFiles = new Set(['csv', 'xlsx', 'xls', 'doc', 'docx', 'pdf', 'txt', 'ppt', 'pptx', 'ods']);
  const mimeByExt: Record<string, string> = {
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    txt: 'text/plain',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet'
  };
  app.post('/api/reports/:id/files', express.raw({
    type: () => true,
    limit: '5mb'
  }), (req, res) => {
    const report = getReport(req, req.params.id);
    if (!['draft', 'correction_requested'].includes(report.status)) fail(409, 'Attachments are locked after submission. Ask an administrator to request a correction.');
    if (Number(one(db, 'SELECT count(*) AS n FROM report_files WHERE report_id=?', report.id)?.n || 0) >= 10) fail(400, 'A report can contain up to 10 attached files.');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) fail(400, 'Choose a non-empty file up to 5 MB.');
    let original = 'upload';
    try {
      original = decodeURIComponent(String(req.headers['x-file-name'] || 'upload'));
    } catch {
      fail(400, 'File name is invalid.');
    }
    original = original.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-255);
    const extension = original.split('.').pop()?.toLowerCase() || '';
    if (!allowedFiles.has(extension)) fail(400, 'Supported formats: CSV, XLSX, XLS, DOC, DOCX, PDF, TXT, PPT, PPTX, and ODS.');
    let parsed: ReturnType<typeof parseUploadedTable>;
    try {
      parsed = parseUploadedTable(extension, body);
    } catch (error) {
      fail(400, error instanceof Error ? error.message : 'This file could not be parsed.');
    }
    const fileId = randomUUID(),
      storageName = fileId + '.' + extension;
    const save = async () => {
      await attachments.put(storageName, body, mimeByExt[extension]);
      try {
        transaction(db, () => {
          exec(db, 'INSERT INTO report_files(id,report_id,user_id,original_name,extension,mime_type,byte_size,storage_name,sheet_name,columns_json,row_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', fileId, report.id, req.user.id, original, extension, mimeByExt[extension], body.length, storageName, parsed?.sheet || '', JSON.stringify(parsed?.columns || []), parsed?.rows.length || 0, now());
          for (let i = 0; i < (parsed?.rows.length || 0); i++) exec(db, 'INSERT INTO report_file_rows(file_id,row_number,values_json) VALUES(?,?,?)', fileId, i + 1, JSON.stringify(parsed!.rows[i]));
          audit(db, req.user.id, 'report.file_uploaded', 'report_file', fileId, null, {
            report_id: report.id,
            name: original,
            bytes: body.length,
            rows: parsed?.rows.length || 0
          });
        });
      } catch (e) {
        await attachments.remove(storageName).catch(() => {});
        throw e;
      }
    };
    void save().then(() => res.status(201).json({
      file: {
        ...one(db, 'SELECT id,report_id,user_id,original_name,extension,mime_type,byte_size,sheet_name,columns_json,row_count,created_at FROM report_files WHERE id=?', fileId),
        columns: parsed?.columns || []
      }
    })).catch(error => {
      console.error('Report attachment storage failed:', error instanceof Error ? error.message : 'Unknown error');
      res.status(500).json({
        error: 'File could not be stored safely.'
      });
    });
  });
  app.get('/api/files/:id', async (req, res) => {
    const f = one(db, 'SELECT * FROM report_files WHERE id=?', req.params.id);
    if (!f) fail(404, 'File not found.');
    scope(req, f.user_id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    const bytes = await attachments.get(f.storage_name);
    res.attachment(f.original_name).type(f.mime_type).send(bytes);
  });
  app.delete('/api/files/:id', async (req, res) => {
    const f = one(db, 'SELECT * FROM report_files WHERE id=?', req.params.id);
    if (!f) fail(404, 'File not found.');
    scope(req, f.user_id);
    const report = getReport(req, f.report_id);
    if (!['draft', 'correction_requested'].includes(report.status)) fail(409, 'Submitted report attachments are locked.');
    transaction(db, () => {
      exec(db, 'DELETE FROM report_files WHERE id=?', f.id);
      audit(db, req.user.id, 'report.file_removed', 'report_file', f.id, f.original_name, null);
    });
    await attachments.remove(f.storage_name);
    res.json({
      ok: true
    });
  });
  app.get('/api/admin/upload-data', (req, res) => {
    admin(req);
    const {
      start,
      end
    } = range(req);
    const clauses = ['r.date BETWEEN ? AND ?'],
      params: unknown[] = [start, end];
    if (req.query.user) {
      clauses.push('r.user_id=?');
      params.push(scope(req, req.query.user));
    }
    if (req.query.role) {
      clauses.push('u.role_id=?');
      params.push(id.parse(req.query.role));
    }
    if (req.query.category) {
      clauses.push('EXISTS(SELECT 1 FROM activities a WHERE a.report_id=r.id AND a.category_id=?)');
      params.push(id.parse(req.query.category));
    }
    const files = all(db, "SELECT f.id,f.report_id,f.original_name,f.extension,f.byte_size,f.sheet_name,f.row_count,f.columns_json,f.created_at,u.id AS user_id,u.name AS user_name,u.employee_code,u.role_id,r.date FROM report_files f JOIN reports r ON r.id=f.report_id JOIN users u ON u.id=r.user_id WHERE r.status IN ('submitted','corrected','approved') AND " + clauses.join(' AND ') + ' ORDER BY r.date DESC,f.created_at DESC', ...(params as any[])).map(f => ({
      ...f,
      columns: JSON.parse(f.columns_json)
    }));
    const rowClauses = [...clauses];
    const rowParams = [...params];
    const selectedFiles = (req.query.files ? String(req.query.files).split(',').filter(Boolean).slice(0, 100) : req.query.file ? [String(req.query.file)] : []).map(value => {
      if (!/^[a-f0-9-]{36}$/i.test(value)) fail(400, 'Uploaded file filter is invalid.');
      return value;
    });
    if (selectedFiles.length) {
      rowClauses.push('f.id IN (' + selectedFiles.map(() => '?').join(',') + ')');
      rowParams.push(...selectedFiles);
    }
    const records = all(db, "SELECT fr.file_id,fr.row_number,fr.values_json,f.report_id,f.original_name,f.extension,f.sheet_name,f.columns_json,u.id AS user_id,u.name AS user_name,u.employee_code,u.role_id,r.date FROM report_file_rows fr JOIN report_files f ON f.id=fr.file_id JOIN reports r ON r.id=f.report_id JOIN users u ON u.id=r.user_id WHERE r.status IN ('submitted','corrected','approved') AND " + rowClauses.join(' AND ') + ' ORDER BY r.date DESC,f.created_at DESC,fr.row_number LIMIT 10000', ...(rowParams as any[]));
    const headers = [...new Set(files.flatMap(x => x.columns as string[]))];
    res.json({
      start,
      end,
      files,
      headers,
      rows: records.map(x => ({
        file_id: x.file_id,
        row_number: x.row_number,
        report_id: x.report_id,
        file_name: x.original_name,
        extension: x.extension,
        sheet: x.sheet_name,
        user_id: x.user_id,
        user_name: x.user_name,
        employee_code: x.employee_code,
        role_id: x.role_id,
        date: x.date,
        values: JSON.parse(x.values_json)
      })),
      total: records.length,
      limit: 10000
    });
  });
  app.post('/api/reports/:id/review', (req, res) => {
    admin(req);
    const r = getReport(req, req.params.id);
    const b = z.object({
      action: z.enum(['comment', 'approve', 'request_correction']),
      comment: z.string().min(1).max(5000),
      improvement_plan: text.default(''),
      quality: z.number().min(0).max(100).nullable().default(null),
      learning: z.number().min(0).max(100).nullable().default(null)
    }).parse(req.body);
    if (r.status === 'draft' || r.status === 'correction_requested' && b.action === 'approve') fail(409, 'Review requires a submitted or corrected report.');
    transaction(db, () => {
      exec(db, 'INSERT INTO feedback(report_id,user_id,actor_id,comment,improvement_plan,quality,learning,created_at) VALUES(?,?,?,?,?,?,?,?)', r.id, r.user_id, req.user.id, b.comment, b.improvement_plan, b.quality, b.learning, now());
      if (b.action !== 'comment') {
        exec(db, 'UPDATE reports SET status=?,version=version+1,updated_at=? WHERE id=?', b.action === 'approve' ? 'approved' : 'correction_requested', now(), r.id);
        const after: Row = {
          ...one(db, 'SELECT * FROM reports WHERE id=?', r.id),
          activities: activitiesFor(r.id),
          files: fileMetadata(r.id)
        };
        exec(db, 'INSERT INTO report_revisions(report_id,version,snapshot,actor_id,created_at) VALUES(?,?,?,?,?)', r.id, after.version, JSON.stringify(after), req.user.id, now());
      }
      audit(db, req.user.id, 'report.' + b.action, 'report', r.id, r, b);
      exec(db, 'INSERT OR IGNORE INTO notifications(user_id,period,kind,title,message,created_at) VALUES(?,?,?,?,?,?)', r.user_id, 'report:' + r.id + ':' + r.version, 'review', b.action === 'request_correction' ? 'Correction requested' : 'Report reviewed', b.comment, now());
    });
    res.json({
      ok: true
    });
  });
  app.get('/api/analytics', (req, res) => {
    const {
      start,
      end
    } = range(req);
    const uid = req.query.user ? scope(req, req.query.user) : null;
    const users = (req.user.access === 'admin' ? all(db, 'SELECT u.*,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE ' + (uid ? 'u.id=?' : 'u.active=1'), ...(uid ? [uid] : [])) : [getUser(req.user.id)]).filter(u => !req.query.role || String(u.role_id) === req.query.role);
    const category = req.query.category ? id.parse(req.query.category) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const results = users.map(u => {
      const s = summary(db, u, start, end, new Date(), category, status, !!uid || req.user.access !== 'admin');
      const p = summary(db, u, s.previousPeriod.start, s.previousPeriod.end, new Date(), category, status);
      return {
        ...s,
        role_name: u.role_name,
        employee_code: u.employee_code,
        pending: s.trend.filter((t: Row) => ['pending', 'draft'].includes(t.status)).length,
        previousScore: p.score,
        scoreChange: s.score !== null && p.score !== null ? Math.round((s.score - p.score) * 100) / 100 : null,
        missing: days(start, end).filter(d => reportingStatus(db, u, d) === 'overdue').map(date => ({
          date,
          status: 'overdue'
        }))
      };
    });
    res.json({
      start,
      end,
      results,
      activeEmployees: users.filter(u => u.active).length,
      comparability: 'Scores use each employee’s assigned model. Compare within the same role and scoring configuration; unrelated output quantities are kept separate.'
    });
  });
  app.post('/api/reflections', (req, res) => {
    const b = z.object({
      start: date,
      end: date,
      self_assessment: text,
      next_plan: text
    }).parse(req.body);
    days(b.start, b.end);
    exec(db, 'INSERT INTO reflections(user_id,start_date,end_date,self_assessment,next_plan,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,start_date,end_date) DO UPDATE SET self_assessment=excluded.self_assessment,next_plan=excluded.next_plan,updated_at=excluded.updated_at', req.user.id, b.start, b.end, b.self_assessment, b.next_plan, now());
    audit(db, req.user.id, 'reflection.saved', 'reflection', req.user.id, null, b);
    res.json({
      ok: true
    });
  });
  app.post('/api/overrides', (req, res) => {
    admin(req);
    const b = z.object({
      user_id: id,
      start: date,
      end: date,
      score: z.number().min(0).max(100),
      reason: z.string().min(10).max(5000)
    }).parse(req.body);
    getUser(b.user_id);
    days(b.start, b.end);
    exec(db, 'INSERT INTO overrides(user_id,start_date,end_date,score,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)', b.user_id, b.start, b.end, b.score, b.reason, req.user.id, now());
    audit(db, req.user.id, 'score.overridden', 'user', b.user_id, null, b);
    res.json({
      ok: true
    });
  });
  app.put('/api/settings', (req, res) => {
    admin(req);
    const b = z.object({
      timezone: zone,
      deadline: clock,
      reminderMinutes: z.number().int().min(0).max(180),
      weeklyDay: z.number().int().min(1).max(7),
      weeklyTime: clock,
      monthlyDay: z.number().int().min(1).max(28),
      monthlyTime: clock
    }).parse(req.body);
    const before = settings(db);
    transaction(db, () => {
      exec(db, 'UPDATE settings SET value=? WHERE id=1', JSON.stringify(b));
      audit(db, req.user.id, 'settings.updated', 'settings', 1, before, b);
    });
    res.json({
      ok: true
    });
  });
  app.post('/api/holidays', (req, res) => {
    admin(req);
    const b = z.object({
      date,
      name: z.string().min(1).max(120)
    }).parse(req.body);
    exec(db, 'INSERT INTO holidays(date,name) VALUES(?,?)', b.date, b.name);
    audit(db, req.user.id, 'holiday.created', 'holiday', b.date, null, b);
    res.json({
      ok: true
    });
  });
  app.post('/api/leave', (req, res) => {
    admin(req);
    const b = z.object({
      user_id: id,
      start_date: date,
      end_date: date,
      reason: z.string().min(1).max(1000)
    }).parse(req.body);
    days(b.start_date, b.end_date);
    getUser(b.user_id);
    exec(db, 'INSERT INTO leave_days(user_id,start_date,end_date,reason) VALUES(?,?,?,?)', b.user_id, b.start_date, b.end_date, b.reason);
    audit(db, req.user.id, 'leave.approved', 'user', b.user_id, null, b);
    res.json({
      ok: true
    });
  });
  app.get('/api/notifications', (req, res) => res.json(all(db, 'SELECT * FROM notifications WHERE user_id=?' + notificationSqlFilter(req.user.access) + ' ORDER BY id DESC LIMIT 200', req.user.id)));
  app.post('/api/notifications/read', (req, res) => {
    exec(db, 'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), req.user.id);
    res.json({
      ok: true
    });
  });
  app.post('/api/jobs/run', async (req, res) => {
    admin(req);
    res.json(await (options.jobs ? options.jobs() : runJobs(db)));
  });
  app.get('/api/audit', (req, res) => {
    admin(req);
    const page = z.coerce.number().int().min(1).parse(req.query.page || 1);
    res.json({
      rows: all(db, 'SELECT a.*,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 30 OFFSET ?', (page - 1) * 30),
      total: one(db, 'SELECT count(*) AS n FROM audit_logs')!.n,
      page
    });
  });
  app.get('/api/export/:format', async (req, res) => {
    const {
      start,
      end
    } = range(req);
    const uid = req.query.user ? scope(req, req.query.user) : req.user.access === 'admin' ? null : req.user.id;
    const users = (uid ? [getUser(uid)] : all(db, 'SELECT u.*,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1')).filter(u => !req.query.role || String(u.role_id) === req.query.role);
    const cat = req.query.category ? id.parse(req.query.category) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const results = users.map(u => ({
      ...summary(db, u, start, end, new Date(), cat, status),
      role_name: u.role_name
    }));
    audit(db, req.user.id, 'export.generated', 'export', req.params.format, null, {
      start,
      end,
      user: uid,
      category: cat,
      status,
      role: req.query.role
    });
    await download(req, res, results);
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({
      error: error.issues.map(i => (i.path.join('.') || 'Input') + ': ' + i.message).join('; ')
    });
    if (error instanceof HttpError) return res.status(error.status).json({
      error: error.message
    });
    if (error instanceof Error && /UNIQUE constraint/.test(error.message)) return res.status(409).json({
      error: 'A record with these details already exists.'
    });
    if (error instanceof Error && /FOREIGN KEY|CHECK constraint/.test(error.message)) return res.status(400).json({
      error: 'Invalid related record or value.'
    });
    if (error instanceof SyntaxError) return res.status(400).json({
      error: 'Invalid JSON request.'
    });
    console.error('Request failed:', error instanceof Error ? error.name : 'Unknown');
    return res.status(500).json({
      error: 'Unable to complete this request.'
    });
  });
  return app;
}
