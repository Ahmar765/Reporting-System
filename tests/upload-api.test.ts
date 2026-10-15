import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { exec, one } from '../server/db.js';
import { localToday } from '../server/domain.js';
import { fixture, reportBody, TEST_PASSWORD } from './helpers.js';
test('report links and uploaded CSV rows are isolated and visible to admin dashboard', async () => {
  const db = await fixture();
  exec(db, 'UPDATE users SET workdays=?', '[1,2,3,4,5,6,7]');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  type Client = {
    cookie: string;
    csrf: string;
  };
  const login = async (email: string) => {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password: TEST_PASSWORD
      })
    });
    const body = await response.json();
    return {
      cookie: response.headers.get('set-cookie')!.split(';')[0],
      csrf: body.csrf
    } as Client;
  };
  const employee = await login('outreach@example.test'),
    admin = await login('admin@example.test');
  const date = localToday();
  let fileId = '';
  try {
    const body = reportBody(date);
    body.activities[0].evidence = '';
    Object.assign(body.activities[0], {
      links: ['https://example.test/one', 'https://example.test/two']
    });
    const saved = await fetch(base + '/api/reports', {
      method: 'POST',
      headers: {
        cookie: employee.cookie,
        'x-csrf-token': employee.csrf,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    assert.equal(saved.status, 200);
    const report = await saved.json();
    const reportId = report.id;
    const padding = 'x'.repeat(710);
    const csv = Buffer.from(['Prospect,Replies,Meetings,Notes', 'Northstar,4,2,' + padding, 'Orchard,3,1,' + padding, ...Array.from({
      length: 998
    }, (_, i) => 'Lead ' + i + ',1,0,' + padding)].join('\r\n'));
    assert.ok(csv.byteLength > 700_000 && csv.byteLength < 5 * 1024 * 1024);
    const upload = await fetch(base + '/api/reports/' + reportId + '/files', {
      method: 'POST',
      headers: {
        cookie: employee.cookie,
        'x-csrf-token': employee.csrf,
        'content-type': 'text/csv',
        'x-file-name': encodeURIComponent('weekly-leads.csv')
      },
      body: csv
    });
    const uploaded = await upload.json();
    assert.equal(upload.status, 201, JSON.stringify(uploaded));
    fileId = uploaded.file.id;
    assert.equal(uploaded.file.row_count, 1000);
    const get = await fetch(base + '/api/reports/' + reportId, {
      headers: {
        cookie: employee.cookie
      }
    });
    const reportDetails = await get.json();
    assert.deepEqual(reportDetails.activities[0].links, ['https://example.test/one', 'https://example.test/two']);
    assert.equal(reportDetails.files[0].original_name, 'weekly-leads.csv');
    const ownInsights = await fetch(base + '/api/reports/' + reportId + '/upload-data', {
      headers: {
        cookie: employee.cookie
      }
    });
    assert.equal(ownInsights.status, 200);
    const ownDataset = await ownInsights.json();
    assert.equal(ownDataset.files.length, 1);
    assert.equal(ownDataset.rows.length, 1000);
    assert.equal((await fetch(base + '/api/reports/' + reportId + '/upload-data', {
      headers: {
        cookie: (await login('developer@example.test')).cookie
      }
    })).status, 403);
    const submitted = await fetch(base + '/api/reports', {
      method: 'POST',
      headers: {
        cookie: employee.cookie,
        'x-csrf-token': employee.csrf,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        ...body,
        version: report.version,
        submit: true
      })
    });
    assert.equal(submitted.status, 200);
    const insights = await fetch(base + '/api/admin/upload-data?start=' + date + '&end=' + date + '&files=' + encodeURIComponent(fileId), {
      headers: {
        cookie: admin.cookie
      }
    });
    assert.equal(insights.status, 200);
    const dataset = await insights.json();
    assert.equal(dataset.rows.length, 1000);
    assert.equal(dataset.files.length, 1);
    assert.equal(dataset.files[0].user_name, 'Fixture Outreach');
    assert.equal(dataset.rows[0].values.Replies, '4');
    assert.equal(dataset.rows[0].user_name, 'Fixture Outreach');
    assert.equal((await fetch(base + '/api/admin/upload-data?start=' + date + '&end=' + date, {
      headers: {
        cookie: employee.cookie
      }
    })).status, 403);
    assert.equal((await fetch(base + '/api/files/' + fileId, {
      headers: {
        cookie: admin.cookie
      }
    })).status, 200);
    assert.equal((await fetch(base + '/api/files/' + fileId, {
      headers: {
        cookie: (await login('developer@example.test')).cookie
      }
    })).status, 403);
    const lockedDelete = await fetch(base + '/api/files/' + fileId, {
      method: 'DELETE',
      headers: {
        cookie: employee.cookie,
        'x-csrf-token': employee.csrf,
        'content-type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(lockedDelete.status, 409);
  } finally {
    if (fileId) {
      const stored = one(db, 'SELECT storage_name FROM report_files WHERE id=?', fileId);
      if (stored) {
        const fs = await import('node:fs/promises');
        await fs.unlink('data/uploads/' + stored.storage_name).catch(() => {});
        exec(db, 'DELETE FROM report_files WHERE id=?', fileId);
      }
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
