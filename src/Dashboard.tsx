import { useEffect, useState } from 'react';
import { Users, FileCheck2, Clock3, Target, ArrowUpRight, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';
import { api, number, percent, type Row } from './api';
import UploadedInsights from './UploadedInsights';
import { Empty, Metric, EmployeeTable, KpiTable, ScoreBreakdown, Field, Badge } from './components';
export default function Dashboard({
  data,
  filters,
  onSelect,
  toast
}: {
  data: Row;
  filters: Row;
  onSelect: (id: number) => void;
  toast: (message: string) => void;
}) {
  const [analytics, setAnalytics] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reflection, setReflection] = useState({
    self_assessment: '',
    next_plan: ''
  });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    api('/analytics?' + query).then(a => {
      if (active) {
        setAnalytics(a);
        setReflection(a.results[0]?.reflection || {
          self_assessment: '',
          next_plan: ''
        });
      }
    }).catch(e => {
      if (active) setError(e.message);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [query]);
  if (busy) return <div className="skeleton" aria-busy="true" aria-label="Loading analytics"><div /><div /><div /></div>;
  if (error) return <div role="alert" className="error">{error}<button onClick={() => {
      setError('');
      setBusy(true);
      api('/analytics?' + query).then(setAnalytics).catch(e => setError(e.message)).finally(() => setBusy(false));
    }}>Retry</button></div>;
  if (!analytics) return null;
  const results: Row[] = analytics.results;
  const admin = data.user.access === 'admin';
  const individual = results.length === 1 && (filters.user || !admin);
  const s = results[0];
  const reports = results.reduce((n, r) => n + r.submitted, 0);
  const missing = results.reduce((n, r) => n + r.missing.length, 0);
  const applicable = results.map(r => r.components.achievement).filter(v => v !== null);
  const achievement = applicable.length ? applicable.reduce((a, b) => a + b, 0) / applicable.length : null;
  const daily = Array.from(new Set<string>(results.flatMap(r => r.trend.map((t: Row) => t.date)))).sort().map(date => ({
    date: date.slice(5),
    submitted: results.reduce((n, r) => n + (r.trend.find((t: Row) => t.date === date)?.reports || 0), 0),
    expected: results.filter(r => r.trend.some((t: Row) => t.date === date)).length
  }));
  const kpiBars = results.flatMap(r => r.kpis.map((k: Row) => ({
    name: (results.length > 1 ? r.user.name.split(' ')[0] + ' · ' : '') + k.name + ' (' + k.unit + ')',
    target: k.target,
    actual: k.actual
  }))).slice(0, 8);
  return <><div className="section-intro"><div><span className="eyebrow">{individual ? 'INDIVIDUAL PERFORMANCE' : 'TEAM WORKSPACE'}</span><h1>{individual ? s.user.name + '’s overview' : 'A clearer view of your team.'}</h1><p>{individual ? s.role_name : 'Track the work. Understand the outcomes. Help your team grow.'}</p></div><div className="live-tag"><span />Live from submitted reports</div></div>
 <div className="metrics"><Metric label={individual ? 'Working days' : 'Active team members'} value={individual ? s.workingDays : analytics.activeEmployees} note={individual ? 'Scheduled days in this period' : 'Across your selected roles'} icon={<Users size={18} />} /><Metric label="Reports submitted" value={reports} note="Submitted, corrected & approved" icon={<FileCheck2 size={18} />} /><Metric label="Overdue reports" value={missing} note={results.reduce((n, r) => n + (r.pending || 0), 0) + ' pending / draft; leave excluded'} icon={<Clock3 size={18} />} /><Metric label="Target achievement" value={percent(achievement)} note={applicable.length + ' comparable evidence sets available'} icon={<Target size={18} />} /></div>
 <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Reporting rhythm</h2><p>Daily submissions against scheduled working days</p></div><TrendingUp size={20} /></div>{daily.length ? <div className="chart" role="img" aria-label={'Daily report submissions: ' + daily.map(d => d.date + ': ' + d.submitted + ' of ' + d.expected).join('; ')}><ResponsiveContainer width="100%" height={250}><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Legend /><Line name="Scheduled" dataKey="expected" stroke="#a6b6ad" strokeDasharray="5 5" dot={false} /><Line name="Submitted" dataKey="submitted" stroke="#27745f" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div> : <Empty title="No scheduled days" text="Choose a period with scheduled working days." />}</section>
 <section className="panel outcome-panel"><div className="panel-heading"><div><h2>Outcomes that matter</h2><p>Each result keeps its own unit</p></div><ArrowUpRight size={20} /></div>{results.some(r => r.outcomes.length) ? <div className="outcome-list">{results.flatMap(r => r.outcomes.slice(0, 4).map((o: Row, i: number) => <div key={r.user.id + ':' + i}><span><strong>{o.name}</strong><small>{r.user.name} · {o.category}</small></span><b>{number(o.actual)}<small>{o.unit}</small></b></div>)).slice(0, 7)}</div> : <Empty title="Your first outcomes start here" text="Assign KPIs, then submit a daily report to see measured results." />}</section></div>
 <section className="panel"><div className="panel-heading"><div><h2>Target versus actual</h2><p>Individual metrics, shown with their measurement units</p></div><Badge status="submitted" /></div>{kpiBars.length ? <div className="chart" role="img" aria-label={kpiBars.map(k => k.name + ': target ' + k.target + ', actual ' + (k.actual ?? 'unreported')).join('; ')}><ResponsiveContainer width="100%" height={280}><BarChart data={kpiBars} margin={{
            bottom: 45
          }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" interval={0} angle={-12} textAnchor="end" height={70} tick={{
              fontSize: 10
            }} /><YAxis /><Tooltip /><Legend /><Bar dataKey="target" name="Target" fill="#d5dfd8" radius={[3, 3, 0, 0]} /><Bar dataKey="actual" name="Actual" fill="#27745f" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty title="Targets make progress visible" text="Create KPI definitions and assign individual targets to start the comparison." />}</section>
 {individual && <section className="panel"><div className="panel-heading"><div><h2>Daily performance trend</h2><p>Daily prorated KPI contributions; gaps indicate insufficient evidence.</p></div></div><div className="chart" role="img" aria-label={s.trend.map((d: Row) => d.date + ': ' + (d.score ?? 'pending')).join('; ')}><ResponsiveContainer width="100%" height={220}><LineChart data={s.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} /><YAxis domain={[0, 100]} /><Tooltip /><Line name="Score" dataKey="score" connectNulls={false} stroke="#27745f" dot /></LineChart></ResponsiveContainer></div></section>}
 <section className="panel"><div className="panel-heading"><div><h2>Activity mix by category</h2><p>Number of recorded activity entries, independent of their quantities.</p></div></div>{results.some(r => r.activities.length) ? <div className="chart" role="img" aria-label={data.categories.map((c: Row) => c.name + ': ' + results.reduce((n, r) => n + r.activities.filter((a: Row) => a.category_id === c.id).length, 0) + ' entries').join('; ')}><ResponsiveContainer width="100%" height={240}><BarChart data={data.categories.map((c: Row) => ({
            name: c.name,
            entries: results.reduce((n, r) => n + r.activities.filter((a: Row) => a.category_id === c.id).length, 0)
          })).filter((c: Row) => c.entries > 0)}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{
              fontSize: 9
            }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="entries" name="Activity entries" fill="#7b9b62" /></BarChart></ResponsiveContainer></div> : <Empty title="No activity distribution yet" text="Submitted activities will build a picture of where your team spends its effort." />}</section>
 {individual ? <><section className="panel"><div className="panel-heading"><div><h2>KPI performance</h2><p>{s.start} — {s.end}</p></div><strong className="score-large">{number(s.score)}<small>{s.rating}</small></strong></div><KpiTable kpis={s.kpis} /></section><ScoreBreakdown summary={s} /><div className="dashboard-grid"><section className="panel"><h2>Feedback & improvement</h2>{s.feedback.length ? s.feedback.map((f: Row) => <blockquote key={f.id}><p>{f.comment}</p>{f.improvement_plan && <p><strong>Next steps:</strong> {f.improvement_plan}</p>}<small>{f.actor}</small></blockquote>) : <Empty title="No feedback yet" text="Manager reviews and improvement plans will appear here." />}</section><section className="panel"><h2>Recurring blockers</h2>{s.blockers.length ? s.blockers.map((b: Row, i: number) => <blockquote key={i}><small>{b.date}</small><p>{b.text}</p></blockquote>) : <Empty title="No blockers recorded" text="Use the daily reflection to flag where help is needed." />}</section></div>{(!admin || s.user.id === data.user.id) && <form className="panel" onSubmit={async e => {
        e.preventDefault();
        try {
          await api('/reflections', {
            start: filters.start,
            end: filters.end,
            ...reflection
          });
          toast('Period reflection saved.');
        } catch (err) {
          toast((err as Error).message);
        }
      }}><h2>Period reflection</h2><div className="form-grid"><Field label="Self-assessment"><textarea value={reflection.self_assessment} onChange={e => setReflection({
              ...reflection,
              self_assessment: e.target.value
            })} /></Field><Field label="Next period’s plan"><textarea value={reflection.next_plan} onChange={e => setReflection({
              ...reflection,
              next_plan: e.target.value
            })} /></Field></div><button className="primary">Save reflection</button></form>}{admin && <UploadedInsights data={data} filters={filters} />}</> : <section className="panel"><div className="panel-heading"><div><h2>People behind the progress</h2><p>Open a team member to explore their results and score breakdown.</p></div><span className="muted">{results.length} members</span></div>{results.length ? <EmployeeTable results={results} onSelect={onSelect} /> : <Empty title="Build your team" text="Create employee accounts from Team members to get started." />}<p className="method">{analytics.comparability}</p></section>}
 {missing > 0 && <section className="panel"><h2>Reports needing attention</h2><div className="attention-list">{results.flatMap(r => r.missing.map((m: Row) => <div key={r.user.id + ':' + m.date}><strong>{r.user.name}</strong><span>{m.date}</span><Badge status="overdue" /></div>)).slice(0, 20)}</div></section>}</>;
}
