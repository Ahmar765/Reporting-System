import { useEffect, useState } from 'react';
import { Download, Bell, CheckCheck, FileSpreadsheet, FileText, Settings2 } from 'lucide-react';
import { api, apiBlob, firebaseMode, timestamp, localDate, type Row } from './api';
import { Field, Badge, Empty } from './components';
type Props = {
  data: Row;
  refresh: () => Promise<void>;
  toast: (m: string) => void;
};
export function Settings({
  data,
  refresh,
  toast
}: Props) {
  const [settings, setSettings] = useState(data.settings);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState({
    user_id: data.users[0]?.id,
    start_date: localDate(data.settings.timezone),
    end_date: localDate(data.settings.timezone),
    reason: ''
  });
  const [password, setPassword] = useState({
    current: '',
    password: ''
  });
  const admin = data.user.access === 'admin';
  const submit = async (path: string, body: unknown, method = 'POST') => {
    setError('');
    try {
      await api(path, body, method);
      await refresh();
      toast('Changes saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return <><div className="section-intro"><div><span className="eyebrow">WORKSPACE PREFERENCES</span><h1>Make the rhythm your own.</h1><p>Reporting rules, time off, reminders, and account security.</p></div><Settings2 size={30} /></div>{error && <div role="alert" className="error">{error}</div>}
 {admin && <><form className="panel" onSubmit={e => {
        e.preventDefault();
        void submit('/settings', settings, 'PUT');
      }}><h2>Reporting & reminder settings</h2><div className="form-grid three"><Field label="Company timezone"><input required value={settings.timezone} onChange={e => setSettings({
              ...settings,
              timezone: e.target.value
            })} /></Field><Field label="Default daily deadline for new employees"><input type="time" required value={settings.deadline} onChange={e => setSettings({
              ...settings,
              deadline: e.target.value
            })} /></Field><Field label="Reminder before deadline (minutes)"><input type="number" min="0" max="180" value={settings.reminderMinutes} onChange={e => setSettings({
              ...settings,
              reminderMinutes: Number(e.target.value)
            })} /></Field><Field label="Weekly review day"><select value={settings.weeklyDay} onChange={e => setSettings({
              ...settings,
              weeklyDay: Number(e.target.value)
            })}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((v, i) => <option key={v} value={i + 1}>{v}</option>)}</select></Field><Field label="Weekly review time"><input type="time" value={settings.weeklyTime} onChange={e => setSettings({
              ...settings,
              weeklyTime: e.target.value
            })} /></Field><Field label="Monthly review day (1–28)"><input type="number" min="1" max="28" value={settings.monthlyDay} onChange={e => setSettings({
              ...settings,
              monthlyDay: Number(e.target.value)
            })} /></Field><Field label="Monthly review time"><input type="time" value={settings.monthlyTime} onChange={e => setSettings({
              ...settings,
              monthlyTime: e.target.value
            })} /></Field></div><p className="notice">{firebaseMode ? 'Reminders appear when you open the workspace or refresh your inbox. Each profile keeps its own deadline and timezone. Background and email reminders are unavailable on this free deployment.' : 'The scheduler runs every minute while the server is running. Each profile has its own daily deadline and timezone. Email requires SMTP environment configuration; delivery status is visible in notifications.'}</p><div className="inline"><button className="primary">Save reporting settings</button><button type="button" onClick={async () => {
            try {
              const r = await api('/jobs/run', {});
              if (firebaseMode) await refresh();
              toast(firebaseMode ? 'Notifications refreshed.' : r.created + ' new notifications generated.');
            } catch (e) {
              setError((e as Error).message);
            }
          }}>{firebaseMode ? 'Refresh notifications' : 'Run reminders now'}</button></div></form><form className="panel" onSubmit={e => {
          e.preventDefault();
          void submit('/leave', leave);
        }}><h2>Approve employee leave</h2><Field label="Employee"><select value={leave.user_id} onChange={e => setLeave({
              ...leave,
              user_id: Number(e.target.value)
            })}>{data.users.map((u: Row) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field><div className="form-grid"><Field label="Start date"><input required type="date" value={leave.start_date} onChange={e => setLeave({
                ...leave,
                start_date: e.target.value
              })} /></Field><Field label="End date"><input required type="date" value={leave.end_date} onChange={e => setLeave({
                ...leave,
                end_date: e.target.value
              })} /></Field></div><Field label="Reason"><input required value={leave.reason} onChange={e => setLeave({
              ...leave,
              reason: e.target.value
            })} /></Field><button className="secondary">Approve leave</button><div className="compact-list">{data.leave.map((l: Row) => <div key={l.id}><strong>{data.users.find((u: Row) => u.id === l.user_id)?.name}</strong><span>{l.start_date} — {l.end_date}</span></div>)}</div></form></>}
 <form className="panel" onSubmit={async e => {
      e.preventDefault();
      try {
        await api('/auth/password', password);
        window.location.reload();
      } catch (e) {
        setError((e as Error).message);
      }
    }}><h2>Change your password</h2><p className="muted">{firebaseMode ? 'Changing your password signs you out. Sign in again with your new password.' : 'Changing your password signs out every session, including this one.'}</p><div className="form-grid"><Field label="Current password"><input required type="password" autoComplete="current-password" value={password.current} onChange={e => setPassword({
            ...password,
            current: e.target.value
          })} /></Field><Field label="New password (12+ characters)"><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password.password} onChange={e => setPassword({
            ...password,
            password: e.target.value
          })} /></Field></div><button className="primary">Change password</button></form></>;
}
export function Exports({
  filters
}: {
  filters: Row;
}) {
  const [dataset, setDataset] = useState('activities');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const download = async (format: string) => {
    setBusy(format);
    setError('');
    try {
      const query = new URLSearchParams({
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        dataset
      } as Record<string, string>);
      const url = URL.createObjectURL(await apiBlob('/export/' + format + '?' + query));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cadence-' + dataset + '-' + filters.start + '-' + filters.end + '.' + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return <><div className="section-intro"><div><span className="eyebrow">TAKE THE INSIGHTS WITH YOU</span><h1>Reports, ready to share.</h1><p>Downloads use the employee, role, category, status, and date filters above.</p></div><Download size={30} /></div>{error && <p className="error" role="alert">{error}</p>}<section className="panel"><h2>Choose your dataset</h2><Field label="Data to export"><select value={dataset} onChange={e => setDataset(e.target.value)}><option value="activities">Detailed activity records</option><option value="kpis">KPI targets & results</option><option value="summaries">Employee performance summaries</option></select></Field><p className="notice">Period: {filters.start} — {filters.end}. PDFs include the score explanation, target breakdown, daily reports, reflections, and manager feedback. Draft activities are excluded from performance calculations and activity exports.</p><div className="export-options">{[['csv', 'CSV', 'Excel-compatible activity data', FileSpreadsheet], ['xlsx', 'Excel workbook', 'A structured workbook with export metadata', FileSpreadsheet], ['pdf', 'PDF report', 'A paginated report for review and archiving', FileText]].map(([format, label, description, Icon]) => {
          const I = Icon as typeof FileText;
          return <button key={String(format)} disabled={!!busy} className="export-option" onClick={() => void download(String(format))}><I size={24} /><strong>{busy === format ? 'Generating…' : String(label)}</strong><span>{String(description)}</span><Download size={16} /></button>;
        })}</div></section></>;
}
export function Notifications({
  data,
  refresh,
  toast
}: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/notifications').then(setRows).catch(e => setError(e.message));
  }, []);
  return <><div className="section-intro"><div><span className="eyebrow">STAY IN THE LOOP</span><h1>Your reporting inbox.</h1><p>Deadline reminders, overdue reports, and manager feedback.</p></div><button className="secondary" onClick={async () => {
        try {
          await api('/notifications/read', {});
          setRows(await api('/notifications'));
          await refresh();
          toast('Notifications marked as read.');
        } catch (e) {
          setError((e as Error).message);
        }
      }}><CheckCheck size={16} />Mark all as read</button></div>{error && <div className="error" role="alert">{error}</div>}<section className="panel">{rows === null ? <div className="skeleton" aria-busy="true"><div /></div> : rows.length ? rows.map(n => <article className={'notification ' + (!n.read_at ? 'unread' : '')} key={n.id}><Bell size={19} /><div><h2>{n.title}</h2><p>{n.message}</p><small>{timestamp(n.created_at, data.user.timezone)}{!firebaseMode && <> · Email: {n.email_status.replaceAll('_', ' ')}</>}{n.delivered_at ? ' · ' + timestamp(n.delivered_at, data.user.timezone) : ''}</small></div>{!n.read_at && <Badge status="new" />}</article>) : <Empty title="You’re all caught up" text="Reminders and review notifications will appear here when they’re due." />}</section></>;
}
export function Audit() {
  const [result, setResult] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/audit?page=' + page).then(setResult).catch(e => setError(e.message));
  }, [page]);
  return <><div className="section-intro"><div><span className="eyebrow">ACCOUNTABILITY, BUILT IN</span><h1>A clear record of change.</h1><p>Authentication, reporting, review, configuration, and export events.</p></div></div>{error && <div className="error" role="alert">{error}</div>}<section className="panel"><div className="table-scroll"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{result?.rows.map((a: Row) => <tr key={a.id}><td>{timestamp(a.created_at)}</td><td>{a.actor || 'System'}</td><td>{a.action}</td><td>{a.entity} #{a.entity_id}</td><td><details><summary>View change</summary><pre>{JSON.stringify({
                      before: a.before_json ? JSON.parse(a.before_json) : null,
                      after: a.after_json ? JSON.parse(a.after_json) : null
                    }, null, 2)}</pre></details></td></tr>)}</tbody></table></div><div className="pagination"><span>{result?.total || 0} events</span><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button disabled={!result || page * 30 >= result.total} onClick={() => setPage(page + 1)}>Next</button></div></section></>;
}
