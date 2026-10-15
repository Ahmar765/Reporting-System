import { DateTime } from './calendar.js';
import nodemailer from 'nodemailer';
import { all, exec, now, audit, type DB, type Row } from './db.js';
import { settings, isWorking, deadlineAt, reportingStatus, localToday } from './domain.js';
let running = false;
export async function runJobs(db: DB, instant = new Date()) {
  if (running) return {
    created: 0,
    busy: true
  };
  running = true;
  let created = 0;
  try {
    const config = settings(db);
    const timestamp = instant.toISOString();
    exec(db, 'DELETE FROM sessions WHERE expires_at<?', timestamp);
    const notify = (user: Row, period: string, kind: string, title: string, message: string) => {
      const r = exec(db, 'INSERT OR IGNORE INTO notifications(user_id,period,kind,title,message,created_at,email_status) VALUES(?,?,?,?,?,?,?)', user.id, period, kind, title, message, timestamp, user.email_notifications && process.env.SMTP_HOST ? 'queued' : 'not_configured');
      created += Number(r.changes);
    };
    for (const u of all(db, 'SELECT * FROM users WHERE active=1 AND notifications=1')) {
      const date = localToday(u.timezone, instant);
      const local = DateTime.fromJSDate(instant, {
        zone: u.timezone
      });
      // A rolling 31-day catch-up detects prior missing reports after downtime.
      for (let offset = 0; offset <= 31; offset++) {
        const d = local.minus({
          days: offset
        }).toISODate()!;
        if (!isWorking(db, u, d)) continue;
        const status = reportingStatus(db, u, d, instant);
        if (!['pending', 'draft', 'overdue'].includes(status)) continue;
        const deadline = DateTime.fromISO(deadlineAt(d, u.deadline, u.timezone));
        if (timestamp > deadline.toISO()!) notify(u, d, 'overdue', 'Daily report overdue', 'Your report for ' + d + ' is overdue. Submit it or contact your manager.');else if (instant.getTime() >= deadline.minus({
          minutes: config.reminderMinutes
        }).toMillis()) notify(u, d, 'due', 'Daily report due soon', 'Your report for ' + d + ' is due at ' + u.deadline + ' ' + u.timezone + '.');
      }
      if (isWorking(db, u, date) && local.weekday === config.weeklyDay && local.toFormat('HH:mm') >= config.weeklyTime) notify(u, local.startOf('week').toISODate()!, 'weekly', 'Weekly review ready', 'Review your generated weekly summary and add a reflection.');
      if (u.joining_date < local.startOf('month').toISODate()! && isWorking(db, u, date) && local.day >= config.monthlyDay && local.toFormat('HH:mm') >= config.monthlyTime) notify(u, local.toFormat('yyyy-MM'), 'monthly', 'Monthly review ready', 'Review your previous month summary and complete your self-assessment.');
    }
    if (created) audit(db, null, 'reminders.generated', 'job', timestamp, null, {
      created
    });
    if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === '465',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined,
        connectionTimeout: 10000,
        socketTimeout: 10000
      });
      for (const n of all(db, "SELECT n.*,u.email FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.email_status='queued' AND u.active=1 AND u.notifications=1 AND u.email_notifications=1 LIMIT 20")) {
        // Claim before delivery. Uncertain deliveries are not retried automatically to avoid duplicates.
        const claim = exec(db, "UPDATE notifications SET email_status='sending' WHERE id=? AND email_status='queued'", n.id);
        if (!claim.changes) continue;
        try {
          await transport.sendMail({
            from: process.env.SMTP_FROM,
            to: n.email,
            subject: n.title,
            text: n.message
          });
          exec(db, "UPDATE notifications SET email_status='delivered',delivered_at=? WHERE id=?", now(), n.id);
        } catch {
          exec(db, "UPDATE notifications SET email_status='failed' WHERE id=?", n.id);
          audit(db, null, 'notification.email_failed', 'notification', n.id);
        }
      }
      transport.close();
    }
    return {
      created,
      busy: false
    };
  } finally {
    running = false;
  }
}
