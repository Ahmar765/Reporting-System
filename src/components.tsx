import { useId, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { Inbox, ArrowUpRight } from 'lucide-react';
import { number, percent, type Row } from './api';
export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const labelId = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<any>, {
    'aria-labelledby': labelId
  }) : children;
  return <label className="field"><span id={labelId}>{label}</span>{control}{hint && <small>{hint}</small>}</label>;
}
export function Empty({
  title = 'No records yet',
  text = 'Your team’s work will appear here as reports are submitted.',
  action
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return <div className="empty"><Inbox size={30} /><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Badge({
  status
}: {
  status: string;
}) {
  return <span className={'badge ' + status}>{status.replaceAll('_', ' ')}</span>;
}
export function Metric({
  label,
  value,
  note,
  icon
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: ReactNode;
}) {
  return <article className="metric"><div className="metric-label">{label}{icon}</div><strong>{value}</strong><small>{note}</small></article>;
}
export function KpiTable({
  kpis
}: {
  kpis: Row[];
}) {
  if (!kpis.length) return <Empty title="No KPIs assigned" text="An administrator can assign metrics and individual targets from Targets & KPIs." />;
  return <div className="table-scroll"><table><thead><tr><th>KPI / period</th><th>Target</th><th>Actual</th><th>Achievement</th><th>Evidence</th></tr></thead><tbody>{kpis.map(k => <tr key={k.id}><td><strong>{k.name}</strong><small>{k.frequency} · {k.unit}</small></td><td>{number(k.target)}</td><td>{number(k.actual)}</td><td><div className="progress"><i style={{
                width: Math.min(100, k.achievement || 0) + '%'
              }} /></div>{percent(k.achievement)}</td><td><Badge status={k.evidence} /></td></tr>)}</tbody></table></div>;
}
export function ScoreBreakdown({
  summary
}: {
  summary: Row;
}) {
  return <section className="panel"><div className="panel-heading"><div><h2>How the score is calculated</h2><p>Model #{summary.config.id} · effective {summary.config.effective_date} · cap {summary.config.cap}%</p></div><Badge status={summary.score === null ? 'pending' : 'complete'} /></div><div className="score-components">{Object.entries(summary.components).map(([key, value]) => <div key={key}><span>{key}<small>{summary.config.weights[key]}% weight</small></span><strong>{percent(value)}</strong></div>)}</div><p className="method">{summary.explanation}</p>{summary.override && <p className="notice">Administrator override: {summary.override.score}. Reason: {summary.override.reason}</p>}</section>;
}
export function EmployeeTable({
  results,
  onSelect
}: {
  results: Row[];
  onSelect: (id: number) => void;
}) {
  return <div className="table-scroll"><table><thead><tr><th>Team member</th><th>Reports</th><th>Target achievement</th><th>Quality</th><th>Score / rating</th><th>Compliance</th><th>Change</th><th><span className="sr-only">View</span></th></tr></thead><tbody>{results.map(s => <tr key={s.user.id}><td><button className="person-link" onClick={() => onSelect(s.user.id)}><span className="avatar">{s.user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}</span><span><strong>{s.user.name}</strong><small>{s.role_name}</small></span></button></td><td>{s.submitted}<small>of {s.workingDays} days</small></td><td>{percent(s.components.achievement)}</td><td>{percent(s.components.quality)}</td><td><strong>{number(s.score)}</strong><small>{s.rating}</small></td><td>{percent(s.compliance)}</td><td>{s.scoreChange === null ? '—' : (s.scoreChange > 0 ? '+' : '') + number(s.scoreChange) + ' pts'}</td><td><button className="icon-button" aria-label={'View ' + s.user.name} onClick={() => onSelect(s.user.id)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div>;
}
