import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import * as XLSX from 'xlsx';
import { createApp } from '../server/app.js';
import { all, one, exec } from '../server/db.js';
import { localToday } from '../server/domain.js';
import { fixture, assign, reportBody, TEST_PASSWORD } from './helpers.js';
test('authenticated reporting, management, export and audit integration', async t => {
  const db = await fixture();
  const aid = assign(db);
  const app = createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const date = localToday();
  exec(db, 'UPDATE users SET workdays=?', '[1,2,3,4,5,6,7]');
  type Client = {
    cookie: string;
    csrf: string;
  };
  async function request(path: string, client?: Client, body?: unknown, method = body ? 'POST' : 'GET') {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(client ? {
          cookie: client.cookie,
          'x-csrf-token': client.csrf
        } : {}),
        ...(body ? {
          'Content-Type': 'application/json'
        } : {})
      },
      ...(body ? {
        body: JSON.stringify(body)
      } : {})
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0] || ''
    };
  }
  async function login(email: string) {
    const result = await request('/auth/login', undefined, {
      email,
      password: TEST_PASSWORD
    });
    assert.equal(result.status, 200);
    return {
      cookie: result.cookie,
      csrf: result.data.csrf
    };
  }
  const admin = await login('admin@example.test'),
    employee = await login('outreach@example.test'),
    other = await login('developer@example.test');
  let reportId = 0;
  let version = 0;
  let created = 0;
  try {
    await t.test('admin inbox and unread badge exclude legacy personal report reminders', async () => {
      for (const kind of ['due', 'overdue', 'weekly', 'monthly', 'review']) exec(db, 'INSERT INTO notifications(user_id,period,kind,title,message,created_at) VALUES(?,?,?,?,?,?)', 1, 'fixture-admin', kind, 'Fixture notification', 'Fixture only', new Date().toISOString());
      exec(db, 'INSERT INTO notifications(user_id,period,kind,title,message,created_at) VALUES(?,?,?,?,?,?)', 2, 'fixture-employee', 'due', 'Fixture employee reminder', 'Fixture only', new Date().toISOString());
      const inbox = await request('/notifications', admin);
      assert.deepEqual(inbox.data.map((n: Record<string, string>) => n.kind), ['review']);
      assert.equal((await request('/bootstrap', admin)).data.unread, 1);
      assert.equal((await request('/notifications', employee)).data.some((n: Record<string, string>) => n.kind === 'due'), true);
    });
    await t.test('anonymous requests and incorrect credentials are rejected', async () => {
      assert.equal((await request('/bootstrap')).status, 401);
      assert.equal((await request('/auth/login', undefined, {
        email: 'outreach@example.test',
        password: 'incorrect'
      })).status, 401);
    });
    await t.test('CSRF and cross-origin mutations are rejected', async () => {
      assert.equal((await request('/reports', {
        ...employee,
        csrf: 'invalid'
      }, reportBody(date, aid))).status, 403);
      const r = await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'outreach@example.test',
          password: TEST_PASSWORD
        })
      });
      assert.equal(r.status, 403);
    });
    await t.test('employee bootstrap exposes only their own records and assigned categories', async () => {
      const r = await request('/bootstrap', employee);
      assert.equal(r.data.users.length, 1);
      assert.equal(r.data.users[0].id, 2);
      assert.equal(r.data.categories.length, 1);
      assert.equal(r.data.categories[0].name, 'LinkedIn');
      assert.ok(!JSON.stringify(r.data).includes('password_hash'));
      assert.ok(!JSON.stringify(r.data).includes('token_hash'));
      assert.equal((await request('/bootstrap', other)).data.categories[0].name, 'Automation');
    });
    await t.test('only admin can create employees with custom roles', async () => {
      const role = await request('/roles', admin, {
        name: 'Fixture Custom Role'
      });
      assert.equal(role.status, 201);
      const p = {
        name: 'Fixture New Employee',
        email: 'new@example.test',
        employee_code: 'TEST-003',
        role_id: role.data.id,
        access: 'employee',
        joining_date: date,
        timezone: 'Asia/Karachi',
        workdays: [1, 2, 3, 4, 5],
        deadline: '22:00',
        notifications: true,
        email_notifications: false,
        category_ids: [1],
        password: TEST_PASSWORD
      };
      assert.equal((await request('/users', employee, p)).status, 403);
      const r = await request('/users', admin, p);
      assert.equal(r.status, 201);
      created = r.data.id;
      assert.equal((await request('/users', admin, p)).status, 409);
    });
    await t.test('multiple activity entries save as a draft and persist', async () => {
      const body = reportBody(date, aid);
      body.activities.push({
        ...body.activities[0],
        assignment_id: null as unknown as number,
        title: 'Follow-ups',
        actual: 7
      });
      const r = await request('/reports', employee, body);
      assert.equal(r.status, 200);
      reportId = r.data.id;
      version = r.data.version;
      assert.equal(r.data.activities.length, 2);
      assert.equal(r.data.status, 'draft');
      assert.equal((await request('/reports/' + reportId, employee)).data.activities[1].actual, 7);
    });
    await t.test('duplicates and stale writes are rejected with one report per date', async () => {
      assert.equal((await request('/reports', employee, reportBody(date, aid))).status, 409);
      assert.equal(all(db, 'SELECT * FROM reports WHERE user_id=2').length, 1);
    });
    await t.test('negative values, duplicate KPI entries and unassigned metrics are rejected', async () => {
      const b = reportBody(date, aid);
      b.version = version;
      b.activities[0].actual = -1;
      assert.equal((await request('/reports', employee, b)).status, 400);
      b.activities[0].actual = 1;
      b.activities.push({
        ...b.activities[0]
      });
      assert.equal((await request('/reports', employee, b)).status, 400);
      b.activities = [{
        ...b.activities[0],
        category_id: 7
      }];
      assert.equal((await request('/reports', employee, b)).status, 403);
    });
    await t.test('draft can be submitted and becomes locked', async () => {
      const current = (await request('/reports/' + reportId, employee)).data;
      const r = await request('/reports', employee, {
        ...current,
        submit: true
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.status, 'submitted');
      version = r.data.version;
      assert.ok(r.data.submitted_at);
      assert.equal((await request('/reports', employee, {
        ...r.data,
        submit: true
      })).status, 409);
      assert.equal((await request('/reports/' + reportId + '/edit', admin, { version })).status, 403);
      assert.equal((await request('/reports/' + reportId + '/edit', employee, { version: version + 1 })).status, 409);
      const opened = await request('/reports/' + reportId + '/edit', employee, { version });
      assert.equal(opened.status, 200);
      assert.equal(opened.data.employee_edit_count, 1);
      assert.equal(opened.data.employee_edit_open, 1);
      assert.equal(opened.data.first_submitted_at, r.data.first_submitted_at);
      version = opened.data.version;
      assert.equal((await request('/reports/' + reportId + '/edit', employee, { version })).status, 409);
    });
    await t.test('cross-employee direct report, analytics, export and target access is forbidden', async () => {
      assert.equal((await request('/reports/' + reportId, other)).status, 403);
      assert.equal((await request('/analytics?start=' + date + '&end=' + date + '&user=2', other)).status, 403);
      assert.equal((await request('/reports?start=' + date + '&end=' + date + '&user=2', other)).status, 403);
      assert.equal((await fetch(base + '/api/export/csv?start=' + date + '&end=' + date + '&user=2', {
        headers: {
          cookie: other.cookie
        }
      })).status, 403);
      assert.equal((await request('/assignments', employee, {
        user_id: 3
      })).status, 403);
    });
    await t.test('admin requests correction; employee saves and resubmits; admin approves', async () => {
      assert.equal((await request('/reports/' + reportId + '/review', admin, {
        action: 'request_correction',
        comment: 'Fixture: clarify the outcomes'
      })).status, 200);
      const requested = (await request('/reports/' + reportId, employee)).data;
      assert.equal(requested.status, 'correction_requested');
      const saved = await request('/reports', employee, {
        ...requested,
        achievements: 'Fixture: corrected achievements',
        submit: false
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.data.status, 'correction_requested');
      const corrected = await request('/reports', employee, {
        ...saved.data,
        submit: true
      });
      assert.equal(corrected.data.status, 'corrected');
      assert.equal(corrected.data.employee_edit_open, 0);
      assert.equal(corrected.data.employee_edit_count, 1);
      assert.equal((await request('/reports/' + reportId + '/edit', employee, { version: corrected.data.version })).status, 409);
      assert.equal((await request('/reports', employee, { ...corrected.data, submit: false })).status, 409);
      assert.equal((await request('/reports/' + reportId + '/review', admin, { action: 'request_correction', comment: 'Cannot grant another edit' })).status, 409);
      assert.equal((await request('/reports/' + reportId + '/review', admin, {
        action: 'approve',
        comment: 'Fixture approved',
        quality: 90,
        learning: 80,
        improvement_plan: 'Continue qualification practice'
      })).status, 200);
      const approved = (await request('/reports/' + reportId, employee)).data;
      assert.equal(approved.status, 'approved');
      assert.ok(approved.revisions.length >= 5);
      assert.equal(approved.feedback.length, 2);
    });
    await t.test('summaries use persisted activity data and distinguish missing components', async () => {
      const r = await request('/analytics?start=' + date + '&end=' + date, employee);
      assert.equal(r.status, 200);
      const s = r.data.results[0];
      assert.equal(s.kpis[0].actual, 18);
      assert.equal(s.kpis[0].achievement, 90);
      assert.equal(s.components.quality, 90);
      assert.equal(s.components.impact, null);
      assert.equal(s.score, null);
      assert.equal(s.outcomes.length, 2);
    });
    await t.test('CSV exports are scoped, filtered and formula protected', async () => {
      exec(db, "UPDATE activities SET notes='=HYPERLINK(\"\"malicious\"\")' WHERE report_id=?", reportId);
      const r = await fetch(base + '/api/export/csv?start=' + date + '&end=' + date + '&user=2', {
        headers: {
          cookie: employee.cookie
        }
      });
      assert.equal(r.status, 200);
      const content = await r.text();
      assert.ok(content.includes('Fixture Outreach'));
      assert.ok(!content.includes('Fixture Developer'));
      assert.ok(content.includes("'=HYPERLINK"));
      const filtered = await fetch(base + '/api/export/csv?start=' + date + '&end=' + date + '&category=7', {
        headers: {
          cookie: employee.cookie
        }
      });
      assert.ok(!(await filtered.text()).includes('Qualified outreach'));
    });
    await t.test('XLSX and PDF downloads contain valid data and formats', async () => {
      const query = '?start=' + date + '&end=' + date + '&user=2';
      const x = await fetch(base + '/api/export/xlsx' + query + '&dataset=kpis', {
        headers: {
          cookie: employee.cookie
        }
      });
      assert.equal(x.status, 200);
      const book = XLSX.read(Buffer.from(await x.arrayBuffer()), {
        type: 'buffer'
      });
      assert.ok(book.SheetNames.includes('kpis'));
      assert.ok(JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets.kpis)).includes('Qualified outreach'));
      const p = await fetch(base + '/api/export/pdf' + query, {
        headers: {
          cookie: employee.cookie
        }
      });
      assert.equal(p.status, 200);
      const bytes = Buffer.from(await p.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(bytes.length > 1500);
    });
    await t.test('deactivation revokes existing sessions immediately', async () => {
      const newClient = await login('new@example.test');
      assert.equal((await request('/users/' + created + '/status', admin, {
        active: false
      })).status, 200);
      assert.equal((await request('/bootstrap', newClient)).status, 401);
      assert.equal((await request('/auth/login', undefined, {
        email: 'new@example.test',
        password: TEST_PASSWORD
      })).status, 401);
      assert.equal((await request('/users/1/status', admin, {
        active: false
      })).status, 400);
    });
    await t.test('admin target and scoring mutations are disabled and preserve historical targets', async () => {
      const next = new Date(date + 'T12:00:00Z');
      next.setUTCDate(next.getUTCDate() + 1);
      const tomorrow = next.toISOString().slice(0, 10);
      assert.equal((await request('/assignments', admin, {
        user_id: 2,
        kpi_id: 1,
        target: 30,
        frequency: 'daily',
        start_date: tomorrow,
        weight: 1
      })).status, 403);
      assert.equal(one(db, 'SELECT end_date FROM assignments WHERE id=?', aid)!.end_date, null);
      assert.equal((await request('/assignments/' + aid + '/end', admin, { end_date: tomorrow })).status, 403);
      assert.equal((await request('/scoring', admin, {
        effective_date: tomorrow,
        weights: {
          achievement: 40,
          quality: 20,
          impact: 20,
          consistency: 10,
          learning: 5
        },
        cap: 100,
        bands: [{
          min: 0,
          label: 'Default'
        }]
      })).status, 403);
    });
    await t.test('period reflection, score override and immutable audit history are persisted', async () => {
      assert.equal((await request('/reflections', employee, {
        start: date,
        end: date,
        self_assessment: 'Fixture assessment',
        next_plan: 'Fixture next plan'
      })).status, 200);
      assert.equal((await request('/overrides', admin, {
        user_id: 2,
        start: date,
        end: date,
        score: 88,
        reason: 'Fixture: reviewed additional supporting evidence'
      })).status, 200);
      assert.equal((await request('/analytics?start=' + date + '&end=' + date, employee)).data.results[0].score, 88);
      assert.equal((await request('/audit', employee)).status, 403);
      const a = await request('/audit', admin);
      assert.ok(a.data.total >= 15);
      assert.ok(all(db, "SELECT * FROM audit_logs WHERE action='report.request_correction'").length);
      assert.ok(all(db, "SELECT * FROM audit_logs WHERE action='score.overridden'").length);
      assert.throws(() => exec(db, 'DELETE FROM audit_logs'));
    });
    await t.test('admin KPI creation and changes are disabled without erasing historical metrics', async () => {
      const before = all(db, 'SELECT * FROM kpis');
      const r = await request('/kpis', admin, {
        name: 'Fixture custom accuracy',
        description: 'Reviewed rate',
        category_id: 7,
        unit: 'percent',
        kind: 'quality',
        aggregation: 'average'
      });
      assert.equal(r.status, 403);
      assert.equal((await request('/kpis/1/status', admin, {
        active: false
      })).status, 403);
      assert.deepEqual(all(db, 'SELECT * FROM kpis'), before);
    });
    await t.test('logout invalidates session', async () => {
      assert.equal((await request('/auth/logout', employee, {})).status, 200);
      assert.equal((await request('/bootstrap', employee)).status, 401);
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    db.close();
  }
});
