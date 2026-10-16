export const reportReminderKinds = ['due', 'overdue', 'weekly', 'monthly'];
export const reportReminderKindsSql = reportReminderKinds.map(kind => "'" + kind + "'").join(',');
export const visibleNotification = (access: string, kind: string) => access !== 'admin' || !reportReminderKinds.includes(kind);
export const notificationSqlFilter = (access: string) => access === 'admin' ? ` AND kind NOT IN (${reportReminderKindsSql})` : '';
