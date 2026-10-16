import { collection, doc, getDocsFromServer, query, where, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { firestore, auth } from './config';
import { all, insertRows, type DB } from './database';
import { DateTime } from '../../server/calendar';
import { localToday, settings, isWorking, deadlineAt, reportingStatus } from '../../server/domain';
import type { Row } from '../../shared/query';
import { visibleNotification } from '../../server/notification-policy';
export async function notificationsFor(db: DB, user: Row, generate = false) {
  const snapshot = await getDocsFromServer(query(collection(firestore, 'cadenceNotifications'), where('owner', '==', user.id)));
  const stored = snapshot.docs.map((d, i) => ({ ...d.data(), id: i + 1, key: d.id, read_at: d.get('read_at')?.toDate?.().toISOString() || d.get('read_at') || null } as Row)).filter(n => visibleNotification(user.access, n.kind));
  const candidates: Row[] = [];
  const notify = (period: string, kind: string, title: string, message: string) => {
    const key = `${user.id}_${encodeURIComponent(period)}_${kind}`;
    if (!stored.some(n => n.key === key)) candidates.push({ key, owner: user.id, user_id: user.id, period, kind, title, message, created_at: new Date().toISOString(), read_at: null, email_status: 'unavailable_on_free_plan', delivered_at: null, actorUid: auth.currentUser!.uid });
  };
  if (generate && user.access === 'employee' && user.notifications) {
    const config = settings(db), instant = new Date(), date = localToday(user.timezone), local = DateTime.fromJSDate(instant, { zone: user.timezone });
    for (let offset = 0; offset <= 31; offset++) {
      const d = local.minus({ days: offset }).toISODate()!;
      if (!isWorking(db, user, d) || !['pending', 'draft', 'overdue'].includes(reportingStatus(db, user, d))) continue;
      const deadline = DateTime.fromISO(deadlineAt(d, user.deadline, user.timezone));
      if (instant.toISOString() > deadline.toISO()!) notify(d, 'overdue', 'Daily report overdue', `Your report for ${d} is overdue. Submit it or contact your manager.`);
      else if (instant.getTime() >= deadline.minus({ minutes: config.reminderMinutes }).toMillis()) notify(d, 'due', 'Daily report due soon', `Your report for ${d} is due at ${user.deadline} ${user.timezone}.`);
    }
    if (isWorking(db, user, date) && local.weekday === config.weeklyDay && local.toFormat('HH:mm') >= config.weeklyTime) notify(local.startOf('week').toISODate()!, 'weekly', 'Weekly review ready', 'Review your weekly summary and add a reflection.');
    if (user.joining_date < local.startOf('month').toISODate()! && local.day >= config.monthlyDay && local.toFormat('HH:mm') >= config.monthlyTime) notify(local.toFormat('yyyy-MM'), 'monthly', 'Monthly review ready', 'Review your previous month summary and add a reflection.');
  }
  if (candidates.length) await runTransaction(firestore, async tx => {
    const refs = candidates.map(n => doc(firestore, 'cadenceNotifications', n.key));
    const existing = await Promise.all(refs.map(r => tx.get(r)));
    candidates.forEach((n, i) => { if (!existing[i].exists()) { const { key: _key, ...data } = n; tx.set(refs[i], { ...data, changedAt: serverTimestamp() }); } });
  });
  const rows = [...stored, ...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200);
  insertRows(db, 'notifications', rows.map(({ key: _key, owner: _owner, actorUid: _actorUid, changedAt: _changedAt, recordedAt: _recordedAt, ...n }, i) => ({ ...n, id: i + 1 })));
  return { rows, created: candidates.length };
}
export async function readNotifications(db: DB, user: Row) {
  const { rows } = await notificationsFor(db, user);
  const batch = writeBatch(firestore);
  for (const n of rows.filter(n => !n.read_at)) batch.update(doc(firestore, 'cadenceNotifications', n.key), { read_at: serverTimestamp() });
  if (rows.some(n => !n.read_at)) await batch.commit();
  return { ok: true };
}
export const unreadCount = (db: DB) => all(db, 'SELECT id FROM notifications WHERE read_at IS NULL').length;
