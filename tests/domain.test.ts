import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, assign, insertReport } from './helpers.js';
import { all, one, exec, now } from '../server/db.js';
import { achievement, weighted, score, targetFor, summary, localToday, days, isWorking, reportingStatus, deadlineAt, configFor } from '../server/domain.js';
import { DateTime } from '../server/calendar.js';
import { runJobs } from '../server/scheduler.js';
import { safeCell, csvCell } from '../server/exports.js';
const bands = [{
  min: 90,
  label: 'Excellent'
}, {
  min: 75,
  label: 'Good'
}, {
  min: 60,
  label: 'Needs Improvement'
}, {
  min: 0,
  label: 'Below Expectations'
}];
test('weighted scoring, caps, zero targets, missing data and rounding', () => {
  assert.equal(achievement(18, 20), 90);
  assert.equal(achievement(100, 20, 120), 120);
  assert.equal(achievement(0, 0), null);
  assert.equal(achievement(null, 20), null);
  assert.equal(weighted([{
    value: 90,
    weight: 3
  }, {
    value: 50,
    weight: 1
  }]), 80);
  assert.equal(weighted([{
    value: null,
    weight: 2
  }]), null);
  assert.deepEqual(score({
    a: 89.995
  }, {
    a: 100
  }, bands), {
    score: 90,
    rating: 'Excellent'
  });
  assert.equal(score({
    a: null,
    b: 100
  }, {
    a: 40,
    b: 60
  }, bands).score, null);
  assert.throws(() => score({
    a: 10
  }, {
    a: 90
  }, bands));
  assert.equal(score({
    a: 120
  }, {
    a: 100
  }, bands).score, 100);
});
test('calendar boundaries, leap dates, Karachi midnight and DST offsets', () => {
  assert.equal(localToday('Asia/Karachi', new Date('2026-01-31T19:01:00Z')), '2026-02-01');
  assert.equal(days('2028-02-28', '2028-03-01').length, 3);
  assert.equal(DateTime.fromISO('2026-02-30').isValid, false);
  assert.equal(DateTime.now().setZone('Bad/Zone').isValid, false);
  assert.equal(DateTime.fromISO('2026-10-01').startOf('week').toISODate(), '2026-09-28');
  assert.equal(DateTime.fromISO('2026-02-01').endOf('month').toISODate(), '2026-02-28');
  assert.equal(deadlineAt('2026-07-01', '22:00', 'America/New_York'), '2026-07-02T02:00:00.000Z');
  assert.equal(deadlineAt('2026-01-01', '22:00', 'America/New_York'), '2026-01-02T03:00:00.000Z');
  assert.equal(deadlineAt('2026-10-15', '22:00', 'Asia/Karachi'), '2026-10-15T17:00:00.000Z');
});
test('daily, weekly and monthly targets use working days and prorate partial periods once', async () => {
  const db = await fixture();
  try {
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    const a = {
      target: 20,
      frequency: 'daily',
      start_date: '2026-01-01',
      end_date: null
    };
    assert.equal(targetFor(db, u, a, '2026-10-05', '2026-10-11'), 100);
    assert.equal(targetFor(db, u, {
      ...a,
      target: 100,
      frequency: 'weekly'
    }, '2026-10-05', '2026-10-11'), 100);
    assert.equal(targetFor(db, u, {
      ...a,
      target: 100,
      frequency: 'weekly'
    }, '2026-10-05', '2026-10-06'), 40);
    assert.equal(targetFor(db, u, {
      ...a,
      target: 220,
      frequency: 'monthly'
    }, '2026-10-01', '2026-10-31'), 220);
    exec(db, "INSERT INTO holidays(date,name) VALUES('2026-10-05','Fixture holiday')");
    exec(db, "INSERT INTO leave_days(user_id,start_date,end_date,reason) VALUES(2,'2026-10-06','2026-10-06','Fixture leave')");
    assert.equal(targetFor(db, u, a, '2026-10-05', '2026-10-11'), 60);
    assert.equal(isWorking(db, u, '2026-10-05'), false);
    assert.equal(reportingStatus(db, u, '2026-10-06', new Date('2026-10-07')), 'not_required');
    assert.equal(reportingStatus(db, u, '2026-12-01', new Date('2026-10-07')), 'pending');
  } finally {
    db.close();
  }
});
test('historical assignment changes preserve targets and missing observations remain pending', async () => {
  const db = await fixture();
  try {
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    const old = assign(db, 2, 1, 20, 'daily', '2026-10-01', '2026-10-15');
    assign(db, 2, 1, 40, 'daily', '2026-10-16');
    insertReport(db, 2, '2026-10-15', [{
      assignment_id: old,
      actual: 18
    }]);
    const s = summary(db, u, '2026-10-15', '2026-10-15', new Date('2026-10-16T12:00Z'));
    assert.equal(s.kpis[0].target, 20);
    assert.equal(s.kpis[0].achievement, 90);
    assert.equal(s.score, null);
    assert.equal(s.components.quality, null);
    assert.equal(summary(db, u, '2026-10-14', '2026-10-15', new Date('2026-10-16T12:00Z')).kpis[0].achievement, null);
    assert.equal(summary(db, u, '2026-10-16', '2026-10-16', new Date('2026-10-16T12:00Z')).kpis[0].target, 40);
  } finally {
    db.close();
  }
});
test('role-specific models, explicit zero results and review evidence produce transparent scores', async () => {
  const db = await fixture();
  try {
    const a = assign(db);
    const impact = assign(db, 2, 2, 2);
    const rid = insertReport(db, 2, '2026-10-15', [{
      assignment_id: a,
      actual: 18
    }, {
      assignment_id: impact,
      actual: 2,
      unit: 'leads'
    }]);
    exec(db, 'INSERT INTO feedback(report_id,user_id,actor_id,comment,quality,learning,created_at) VALUES(?,2,1,?,80,100,?)', rid, 'Fixture review', now());
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    const s = summary(db, u, '2026-10-15', '2026-10-15', new Date('2026-10-16T12:00Z'));
    assert.equal(s.score, 91);
    exec(db, 'INSERT INTO scoring_configs(user_id,role_id,effective_date,weights,cap,bands,created_at) VALUES(NULL,6,?,?,?,?,?)', '2026-01-01', JSON.stringify({
      achievement: 0,
      quality: 100,
      impact: 0,
      consistency: 0,
      learning: 0
    }), 100, JSON.stringify(bands), now());
    const t = assign(db, 3, 3, 10);
    insertReport(db, 3, '2026-10-15', [{
      category_id: 7,
      assignment_id: t,
      actual: 0,
      unit: 'tests'
    }]);
    const dev = one(db, 'SELECT * FROM users WHERE id=3')!;
    assert.equal(configFor(db, dev, '2026-10-15').weights.quality, 100);
    assert.equal(summary(db, dev, '2026-10-15', '2026-10-15', new Date('2026-10-16T12:00Z')).score, 0);
  } finally {
    db.close();
  }
});
test('notifications respect deadlines, leave, future days, account state and deduplication', async () => {
  const db = await fixture();
  try {
    exec(db, "UPDATE users SET joining_date='2026-10-15',email_notifications=1 WHERE id IN(1,2,3)");
    exec(db, "INSERT INTO leave_days(user_id,start_date,end_date,reason) VALUES(3,'2026-10-15','2026-10-15','Fixture leave')");
    await runJobs(db, new Date('2026-10-15T16:20:00Z'));
    assert.equal(all(db, 'SELECT * FROM notifications').length, 0);
    await runJobs(db, new Date('2026-10-15T16:35:00Z'));
    assert.equal(all(db, "SELECT * FROM notifications WHERE kind='due'").length, 1);
    await runJobs(db, new Date('2026-10-15T16:40:00Z'));
    assert.equal(all(db, "SELECT * FROM notifications WHERE kind='due'").length, 1);
    await runJobs(db, new Date('2026-10-15T17:01:00Z'));
    assert.equal(all(db, "SELECT * FROM notifications WHERE kind='overdue'").length, 1);
    assert.equal(all(db, 'SELECT * FROM notifications WHERE user_id=1').length, 0, 'Administrators do not submit personal reports.');
    assert.equal(all(db, 'SELECT * FROM notifications WHERE user_id=3').length, 0);
    assert.equal(all(db, 'SELECT * FROM notifications WHERE delivered_at IS NOT NULL').length, 0);
    exec(db, 'UPDATE users SET active=0 WHERE id=2');
    await runJobs(db, new Date('2026-10-16T18:00:00Z'));
    assert.equal(all(db, "SELECT * FROM notifications WHERE user_id=2 AND period='2026-10-16'").length, 0);
  } finally {
    db.close();
  }
});
test('spreadsheet exports protect formula injection including leading whitespace', () => {
  for (const v of ['=CMD()', ' +SUM(1)', '\t@SUM(1)', '-1+2']) assert.ok(safeCell(v).startsWith("'"));
  assert.equal(safeCell('normal'), 'normal');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
test('fixed quotas reduce for holidays, leave, and mid-period joining dates', async () => {
  const db = await fixture();
  try {
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    const a = {
      target: 100,
      frequency: 'weekly',
      start_date: '2026-01-01',
      end_date: null
    };
    exec(db, "INSERT INTO holidays(date,name) VALUES('2026-10-05','Fixture holiday')");
    exec(db, "INSERT INTO leave_days(user_id,start_date,end_date,reason) VALUES(2,'2026-10-06','2026-10-06','Fixture leave')");
    assert.equal(targetFor(db, u, a, '2026-10-05', '2026-10-11'), 60);
    assert.equal(summary(db, u, '2027-01-04', '2027-01-08', new Date('2026-10-15T12:00Z')).workingDays, 0);
  } finally {
    db.close();
  }
});
test('reviewed quality below a minimum is a measured failed gate, not missing evidence', async () => {
  const db = await fixture();
  try {
    const a = assign(db);
    exec(db, 'UPDATE assignments SET minimum_quality=80 WHERE id=?', a);
    const rid = insertReport(db, 2, '2026-10-15', [{
      assignment_id: a,
      actual: 20
    }]);
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    assert.equal(summary(db, u, '2026-10-15', '2026-10-15', new Date('2026-10-16')).kpis[0].achievement, null);
    exec(db, 'INSERT INTO feedback(report_id,user_id,actor_id,comment,quality,created_at) VALUES(?,2,1,?,60,?)', rid, 'Fixture reviewed', now());
    const k = summary(db, u, '2026-10-15', '2026-10-15', new Date('2026-10-16')).kpis[0];
    assert.equal(k.achievement, 0);
    assert.equal(k.qualityGate, 'below_minimum');
    assert.equal(k.evidence, 'complete');
  } finally {
    db.close();
  }
});
test('historical schedule and role model remain stable after a current profile change', async () => {
  const db = await fixture();
  try {
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    exec(db, 'INSERT INTO profile_versions(user_id,effective_date,snapshot,created_at) VALUES(?,?,?,?)', 2, '0001-01-01', JSON.stringify({
      role_id: 3,
      workdays: '[1,2,3,4,5]',
      timezone: 'Asia/Karachi',
      deadline: '22:00',
      joining_date: '2026-01-01'
    }), now());
    exec(db, 'INSERT INTO profile_versions(user_id,effective_date,snapshot,created_at) VALUES(?,?,?,?)', 2, '2026-10-16', JSON.stringify({
      role_id: 6,
      workdays: '[7]',
      timezone: 'UTC',
      deadline: '12:00',
      joining_date: '2026-01-01'
    }), now());
    assert.equal(isWorking(db, u, '2026-10-15'), true);
    assert.equal(isWorking(db, u, '2026-10-16'), false);
    assert.equal(isWorking(db, u, '2026-10-18'), true);
  } finally {
    db.close();
  }
});
test('multiple target versions contribute once per KPI, weighted by their period targets', async () => {
  const db = await fixture();
  try {
    const old = assign(db, 2, 1, 20, 'daily', '2026-10-12', '2026-10-13');
    const next = assign(db, 2, 1, 40, 'daily', '2026-10-14');
    const extra = Number(exec(db, "INSERT INTO kpis(name,description,category_id,unit,kind) VALUES('Fixture secondary','',1,'actions','achievement')").lastInsertRowid);
    const secondary = assign(db, 2, extra, 10, 'daily', '2026-10-12');
    for (const date of days('2026-10-12', '2026-10-16')) insertReport(db, 2, date, [{
      assignment_id: date < '2026-10-14' ? old : next,
      actual: 20
    }, {
      assignment_id: secondary,
      actual: 10
    }]);
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    assert.equal(summary(db, u, '2026-10-12', '2026-10-16', new Date('2026-10-17')).components.achievement, 81.25);
  } finally {
    db.close();
  }
});
test('first submission timestamp remains the compliance reference after a correction', async () => {
  const db = await fixture();
  try {
    const rid = insertReport(db, 2, '2026-10-15', [], '2026-10-16T18:00:00.000Z');
    exec(db, "UPDATE reports SET first_submitted_at='2026-10-15T16:00:00.000Z',status='corrected' WHERE id=?", rid);
    const u = one(db, 'SELECT * FROM users WHERE id=2')!;
    assert.equal(reportingStatus(db, u, '2026-10-15', new Date('2026-10-17')), 'corrected');
    assert.equal(summary(db, u, '2026-10-15', '2026-10-15', new Date('2026-10-17')).compliance, 100);
  } finally {
    db.close();
  }
});
test('rate metrics average daily observations without summing percentages', async () => {
  const db = await fixture();
  try {
    const kid = Number(exec(db, "INSERT INTO kpis(name,description,category_id,unit,kind,aggregation) VALUES('Fixture pass rate','',7,'percent','quality','average')").lastInsertRowid);
    const aid = assign(db, 3, kid, 100);
    insertReport(db, 3, '2026-10-14', [{
      category_id: 7,
      assignment_id: aid,
      actual: 80,
      unit: 'percent'
    }]);
    insertReport(db, 3, '2026-10-15', [{
      category_id: 7,
      assignment_id: aid,
      actual: 100,
      unit: 'percent'
    }]);
    const u = one(db, 'SELECT * FROM users WHERE id=3')!;
    const s = summary(db, u, '2026-10-14', '2026-10-15', new Date('2026-10-16'));
    assert.equal(s.kpis[0].target, 100);
    assert.equal(s.kpis[0].actual, 90);
    assert.equal(s.components.quality, 90);
    assert.equal(s.outcomes[0].actual, 90);
  } finally {
    db.close();
  }
});
