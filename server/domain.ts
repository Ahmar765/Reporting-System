import { DateTime } from './calendar.js';
import { all, one, type ReadDB as DB, type Row } from './query.js';
export const settings = (db: DB) => JSON.parse(one(db, 'SELECT value FROM settings WHERE id=1')!.value);
export function localToday(zone = 'Asia/Karachi', instant = new Date()) {
  return DateTime.fromJSDate(instant, {
    zone
  }).toISODate()!;
}
export function days(start: string, end: string) {
  const result: string[] = [];
  let d = DateTime.fromISO(start, {
    zone: 'UTC'
  });
  const last = DateTime.fromISO(end, {
    zone: 'UTC'
  });
  if (!d.isValid || !last.isValid || last < d || last.diff(d, 'days').days > 366) throw Error('Choose an ordered date range of at most 367 days.');
  while (d <= last) {
    result.push(d.toISODate()!);
    d = d.plus({
      days: 1
    });
  }
  return result;
}
export function scheduleFor(db: DB, user: Row, date: string): Row {
  const version = one(db, 'SELECT snapshot FROM profile_versions WHERE user_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1', user.id, date);
  return version ? {
    ...user,
    ...JSON.parse(version.snapshot)
  } : user;
}
export function isWorking(db: DB, user: Row, date: string) {
  user = scheduleFor(db, user, date);
  const weekday = DateTime.fromISO(date).weekday;
  return date >= user.joining_date && JSON.parse(user.workdays).includes(weekday) && !one(db, 'SELECT id FROM holidays WHERE date=?', date) && !one(db, 'SELECT id FROM leave_days WHERE user_id=? AND approved=1 AND start_date<=? AND end_date>=?', user.id, date, date);
}
export const deadlineAt = (date: string, time: string, zone: string) => DateTime.fromISO(date + 'T' + time, {
  zone
}).toUTC().toISO()!;
export function reportingStatus(db: DB, user: Row, date: string, instant = new Date()) {
  if (!isWorking(db, user, date)) return 'not_required';
  const r = one(db, 'SELECT * FROM reports WHERE user_id=? AND date=?', user.id, date);
  const schedule = scheduleFor(db, user, date);
  const deadline = deadlineAt(date, schedule.deadline, schedule.timezone);
  if (r && r.status !== 'draft') return (r.first_submitted_at || r.submitted_at) && (r.first_submitted_at || r.submitted_at) > deadline ? 'late' : r.status;
  if (instant.toISOString() > deadline) return 'overdue';
  return r ? 'draft' : 'pending';
}
export function targetFor(db: DB, user: Row, a: Row, start: string, end: string) {
  if (a.aggregation === 'average') return days(start, end).some(d => d >= a.start_date && (!a.end_date || d <= a.end_date) && isWorking(db, user, d)) ? a.target : 0;
  let total = 0;
  const used = new Set<string>();
  for (const date of days(start, end)) {
    if (date < a.start_date || a.end_date && date > a.end_date || !isWorking(db, user, date)) continue;
    if (a.frequency === 'daily') {
      total += a.target;
      continue;
    }
    const d = DateTime.fromISO(date);
    const periodStart = d.startOf(a.frequency === 'weekly' ? 'week' : 'month');
    const periodEnd = d.endOf(a.frequency === 'weekly' ? 'week' : 'month');
    const key = periodStart.toISODate()!;
    if (used.has(key)) continue;
    used.add(key);
    const whole = days(key, periodEnd.toISODate()!).filter(x => JSON.parse(scheduleFor(db, user, x).workdays).includes(DateTime.fromISO(x).weekday));
    const included = whole.filter(x => isWorking(db, user, x) && x >= start && x <= end && x >= a.start_date && (!a.end_date || x <= a.end_date));
    total += whole.length ? a.target * included.length / whole.length : 0;
  }
  return Math.round(total * 10000) / 10000;
}
export function weighted(items: {
  value: number | null;
  weight: number;
}[]) {
  if (!items.length || items.some(x => x.value === null)) return null;
  const sum = items.reduce((s, x) => s + x.weight, 0);
  return sum > 0 ? items.reduce((s, x) => s + x.value! * x.weight, 0) / sum : null;
}
export function achievement(actual: number | null, target: number, cap = 100) {
  return actual === null || target <= 0 ? null : Math.min(cap, actual / target * 100);
}
export function score(components: Record<string, number | null>, weights: Record<string, number>, bands: {
  min: number;
  label: string;
}[]) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.001) throw Error('Scoring weights must total 100%.');
  const value = weighted(Object.entries(weights).filter(([, w]) => w > 0).map(([key, weight]) => ({
    value: components[key] ?? null,
    weight
  })));
  const rounded = value === null ? null : Math.round(Math.min(100, value) * 100) / 100;
  return {
    score: rounded,
    rating: rounded === null ? 'Insufficient evidence' : bands.find(b => rounded >= b.min)?.label || 'Unrated'
  };
}
export function configFor(db: DB, user: Row, date: string): Row {
  user = scheduleFor(db, user, date);
  const c = one(db, 'SELECT * FROM scoring_configs WHERE effective_date<=? AND (user_id=? OR (user_id IS NULL AND role_id=?) OR (user_id IS NULL AND role_id IS NULL)) ORDER BY CASE WHEN user_id IS NOT NULL THEN 0 WHEN role_id IS NOT NULL THEN 1 ELSE 2 END,effective_date DESC,id DESC LIMIT 1', date, user.id, user.role_id)!;
  return {
    ...c,
    weights: JSON.parse(c.weights),
    bands: JSON.parse(c.bands)
  };
}
export function summary(db: DB, user: Row, start: string, end: string, instant = new Date(), categoryId?: number, status?: string, includeDaily = false) {
  const today = localToday(user.timezone, instant);
  const dates = days(start, end).filter(d => d <= today && isWorking(db, user, d));
  const reports = all(db, 'SELECT * FROM reports WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date', user.id, start, end);
  const submitted = reports.filter(r => r.status !== 'draft');
  const filteredReports = reports.filter(r => (!status || r.status === status || status === 'late' && reportingStatus(db, user, r.date, instant) === 'late') && (!categoryId || one(db, 'SELECT id FROM activities WHERE report_id=? AND category_id=?', r.id, categoryId)));
  const selected = filteredReports.filter(r => !['draft', 'correction_requested'].includes(r.status));
  const reportIds = new Set(selected.map(r => r.id));
  const activities = all(db, 'SELECT a.*,r.date,r.user_id,r.status AS report_status,t.kpi_id,k.name AS kpi_name,k.kind,k.aggregation,c.name AS category FROM activities a JOIN reports r ON r.id=a.report_id JOIN categories c ON c.id=a.category_id LEFT JOIN assignments t ON t.id=a.assignment_id LEFT JOIN kpis k ON k.id=t.kpi_id WHERE r.user_id=? AND r.date BETWEEN ? AND ? ORDER BY r.date,a.id', user.id, start, end).filter(a => reportIds.has(a.report_id) && (!categoryId || a.category_id === categoryId));
  const config = configFor(db, user, start);
  const assignments = all(db, 'SELECT t.*,k.name,k.unit,k.kind,k.category_id,k.aggregation FROM assignments t JOIN kpis k ON k.id=t.kpi_id WHERE t.user_id=? AND t.start_date<=? AND (t.end_date IS NULL OR t.end_date>=?)', user.id, end, start).filter(a => !categoryId || a.category_id === categoryId);
  const kpis: Row[] = assignments.map(a => {
    const entries = activities.filter(x => x.assignment_id === a.id);
    const targetEnd = end < today ? end : today;
    const target = targetEnd < start ? 0 : targetFor(db, user, a, start, targetEnd);
    const expected = dates.filter(d => d >= a.start_date && (!a.end_date || d <= a.end_date));
    const reported = expected.every(d => entries.some(x => x.date === d));
    const actual = entries.length ? entries.reduce((s, e) => s + e.actual, 0) / (a.aggregation === 'average' ? entries.length : 1) : null;
    const qualityReviews = entries.map(x => one(db, 'SELECT quality FROM feedback WHERE report_id=? AND quality IS NOT NULL ORDER BY id DESC LIMIT 1', x.report_id)?.quality ?? null);
    const qualityKnown = a.minimum_quality === null || qualityReviews.every(v => v !== null);
    const qualityPass = a.minimum_quality === null || qualityReviews.every(v => v !== null && v >= a.minimum_quality);
    return {
      ...a,
      expectedDays: expected.length,
      assignedTarget: a.target,
      target,
      actual,
      qualityGate: a.minimum_quality === null ? 'not_applicable' : !qualityKnown ? 'pending' : qualityPass ? 'passed' : 'below_minimum',
      evidence: reported && qualityKnown && target > 0 ? 'complete' : 'pending',
      achievement: reported && qualityKnown ? qualityPass ? achievement(actual, target, config.cap) : 0 : null
    };
  });
  const reviewValues = (field: 'quality' | 'learning') => {
    if (!selected.length) return null;
    const vals = selected.map(r => one(db, 'SELECT ' + field + ' AS value FROM feedback WHERE report_id=? AND ' + field + ' IS NOT NULL ORDER BY id DESC LIMIT 1', r.id)?.value ?? null);
    return vals.some(v => v === null) ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const component = (kind: string) => {
    const groups = new Map<number, Row[]>();
    for (const k of kpis.filter(k => k.kind === kind && k.target > 0)) {
      const group = groups.get(k.kpi_id) || [];
      group.push(k);
      groups.set(k.kpi_id, group);
    }
    return weighted([...groups.values()].map(group => ({
      value: weighted(group.map(k => ({
        value: k.achievement,
        weight: k.aggregation === 'average' ? k.expectedDays : k.target
      }))),
      weight: group.reduce((s, k) => s + k.weight * k.expectedDays, 0) / group.reduce((s, k) => s + k.expectedDays, 0)
    })));
  };
  const compliance = dates.length ? dates.filter(d => submitted.some(r => r.date === d && (r.first_submitted_at || r.submitted_at) <= deadlineAt(d, scheduleFor(db, user, d).deadline, scheduleFor(db, user, d).timezone))).length / dates.length * 100 : null;
  const components = {
    achievement: component('achievement'),
    quality: kpis.some(k => k.kind === 'quality') ? component('quality') : reviewValues('quality'),
    impact: component('impact'),
    consistency: compliance,
    learning: reviewValues('learning')
  };
  const calculated = score(components, config.weights, config.bands);
  const override = one(db, 'SELECT o.*,u.name AS actor FROM overrides o JOIN users u ON u.id=o.actor_id WHERE o.user_id=? AND o.start_date=? AND o.end_date=? ORDER BY o.id DESC LIMIT 1', user.id, start, end);
  const previousStart = DateTime.fromISO(start).minus({
    days: days(start, end).length
  }).toISODate()!;
  const previousEnd = DateTime.fromISO(start).minus({
    days: 1
  }).toISODate()!;
  const outcomes = Object.values(activities.reduce<Record<string, Row>>((map, a) => {
    const key = (a.kpi_id ? 'kpi:' + a.kpi_id : 'activity:' + a.title) + ':' + a.unit;
    if (!map[key]) map[key] = {
      name: a.kpi_name || a.title,
      unit: a.unit,
      category: a.category,
      actual: 0,
      count: 0,
      aggregation: a.aggregation || (['percent', '%'].includes(a.unit) ? 'average' : 'sum')
    };
    map[key].actual += a.actual;
    map[key].count++;
    return map;
  }, {})).map(o => ({
    ...o,
    actual: o.aggregation === 'average' ? o.actual / o.count : o.actual
  }));
  const trend: Row[] = dates.map(date => ({
    date,
    reports: submitted.some(r => r.date === date) ? 1 : 0,
    status: reportingStatus(db, user, date, instant),
    score: includeDaily ? summary(db, user, date, date, instant, categoryId, status, false).score : null
  }));
  return {
    user: {
      id: user.id,
      name: user.name,
      role_id: user.role_id
    },
    start,
    end,
    workingDays: dates.length,
    submitted: filteredReports.filter(r => r.status !== 'draft').length,
    completion: dates.length ? Math.min(100, submitted.filter(r => dates.includes(r.date)).length / dates.length * 100) : null,
    compliance,
    kpis,
    components,
    config,
    ...calculated,
    calculatedScore: calculated.score,
    score: override ? override.score : calculated.score,
    rating: override ? config.bands.find((b: {
      min: number;
    }) => override.score >= b.min)?.label : calculated.rating,
    override: override || null,
    previousPeriod: {
      start: previousStart,
      end: previousEnd
    },
    reports: filteredReports,
    activities,
    outcomes,
    trend,
    blockers: selected.filter(r => r.blockers).map(r => ({
      date: r.date,
      text: r.blockers
    })),
    feedback: all(db, 'SELECT f.*,u.name AS actor FROM feedback f JOIN users u ON u.id=f.actor_id LEFT JOIN reports r ON r.id=f.report_id WHERE f.user_id=? AND ((r.date BETWEEN ? AND ?) OR (f.report_id IS NULL AND substr(f.created_at,1,10) BETWEEN ? AND ?)) ORDER BY f.id DESC', user.id, start, end, start, end),
    reflection: one(db, 'SELECT * FROM reflections WHERE user_id=? AND start_date=? AND end_date=?', user.id, start, end) || null,
    explanation: 'KPIs use scheduled working days and versioned assignments. Weekly/monthly count quotas are prorated by scheduled days, never multiplied per report. Rate metrics average daily values against a constant threshold. A KPI needs an explicit observation on every applicable day. Missing evidence leaves weighted components and the overall score pending. Reporting compliance is independent of quality. Partial or category/status-filtered views may lack scoring evidence.'
  };
}
