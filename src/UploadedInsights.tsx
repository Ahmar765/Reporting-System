import { FileDownload } from './FileDownload';
import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { api, type Row } from './api';
import { Field, Empty } from './components';
export default function UploadedInsights({
  data,
  filters
}: {
  data: Row;
  filters: Row;
}) {
  const [source, setSource] = useState<Row>({
    headers: [],
    rows: [],
    total: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState({
    start: filters.start || '',
    end: filters.end || ''
  });
  const [employee, setEmployee] = useState(String(filters.user || ''));
  const [role, setRole] = useState(String(filters.role || ''));
  const [category, setCategory] = useState(String(filters.category || ''));
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [metric, setMetric] = useState('');
  const [radarEmployee, setRadarEmployee] = useState('');
  useEffect(() => setDateRange({
    start: filters.start || '',
    end: filters.end || ''
  }), [filters.start, filters.end]);
  useEffect(() => {
    setEmployee(String(filters.user || ''));
    setRole(String(filters.role || ''));
    setCategory(String(filters.category || ''));
  }, [filters.user, filters.role, filters.category]);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange.start) p.set('start', dateRange.start);
    if (dateRange.end) p.set('end', dateRange.end);
    if (employee) p.set('user', employee);
    if (role) p.set('role', role);
    if (category) p.set('category', category);
    if (fileIds.length) p.set('files', fileIds.join(','));
    return p.toString();
  }, [dateRange, employee, role, category, fileIds]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api('/admin/upload-data?' + query).then((r: Row) => {
      if (alive) {
        setSource(r);
        if (fileIds.length && fileIds.some(id => !r.files?.some((f: Row) => String(f.id) === id))) setFileIds(current => current.filter(id => r.files?.some((f: Row) => String(f.id) === id)));
        setColumnFilters({});
        if (!metric || !r.headers.includes(metric)) setMetric(r.headers.find((h: string) => r.rows.some((x: Row) => Number.isFinite(Number(x.values[h])) && x.values[h] !== '')) || '');
      }
    }).catch((e: Error) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, fileIds]);
  const rows = source.rows.filter((r: Row) => Object.entries(columnFilters).every(([key, value]) => !value || String(r.values[key] ?? '') === value));
  const numeric = source.headers.filter((h: string) => source.rows.some((r: Row) => r.values[h] !== '' && Number.isFinite(Number(r.values[h]))));
  const people = [...new Map(rows.map((r: Row) => [r.user_id, {
    id: String(r.user_id),
    name: r.user_name
  }])).values()] as Row[];
  const byPerson = people.map((person: Row) => {
    const values = rows.filter((r: Row) => String(r.user_id) === person.id).map((r: Row) => Number(r.values[metric])).filter((n: number) => Number.isFinite(n));
    return {
      name: person.name,
      value: values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0,
      rows: values.length
    };
  }).filter((x: Row) => x.rows);
  const chosen = people.find((p: Row) => p.id === (radarEmployee || people[0]?.id)) || people[0];
  const radar = numeric.slice(0, 8).map((name: string) => {
    const selected = rows.filter((r: Row) => String(r.user_id) === chosen?.id).map((r: Row) => Number(r.values[name])).filter((n: number) => Number.isFinite(n));
    const allValues = rows.map((r: Row) => Number(r.values[name])).filter((n: number) => Number.isFinite(n));
    const avg = selected.length ? selected.reduce((a: number, b: number) => a + b, 0) / selected.length : 0;
    const max = allValues.length ? Math.max(...allValues) : 0;
    return {
      metric: name,
      score: max > 0 ? Math.round(Math.max(0, avg / max) * 100) : 0,
      average: avg
    };
  });
  return <section className="panel uploaded-insights"><div className="panel-heading"><div><span className="eyebrow">SPREADSHEET INSIGHTS</span><h2>Uploaded report data</h2><p>CSV and XLSX rows are indexed when attached to a daily report. Filter and compare them here.</p></div><span className="badge">{rows.length} rows</span></div>
 <div className="filterbar upload-filters"><Field label="From"><input type="date" value={dateRange.start} onChange={e => setDateRange({
          ...dateRange,
          start: e.target.value
        })} /></Field><Field label="To"><input type="date" value={dateRange.end} onChange={e => setDateRange({
          ...dateRange,
          end: e.target.value
        })} /></Field><Field label="Employee"><select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">All employees</option>{data.users.map((u: Row) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></Field><Field label="Role"><select value={role} onChange={e => setRole(e.target.value)}><option value="">All roles</option>{data.roles.map((x: Row) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></Field><Field label="Category"><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{data.categories.map((x: Row) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></Field><Field label="Uploaded files · Ctrl/Cmd-select multiple"><select multiple size={4} aria-label="Filter by one or more uploaded files" value={fileIds} onChange={e => setFileIds(Array.from(e.currentTarget.selectedOptions, option => option.value))}>{(source.files || []).map((f: Row) => <option key={f.id} value={f.id}>{f.original_name} · {f.user_name}</option>)}</select></Field></div>
 {!loading && source.files?.length > 0 && <div className="uploaded-file-list"><div className="panel-heading"><div><h3>Uploaded items</h3><p>Files submitted by team members in the selected date and employee range.</p></div><span className="muted">{source.files.length} files</span></div><div className="table-scroll"><table><thead><tr><th>Employee</th><th>Report date</th><th>File</th><th>Format</th><th>Rows</th><th>Size</th><th>Attachment</th></tr></thead><tbody>{source.files.map((f: Row) => <tr key={f.id}><td>{f.user_name}</td><td>{f.date}</td><td>{f.original_name}</td><td>{String(f.extension).toUpperCase()}</td><td>{f.row_count || '—'}</td><td>{Math.round(Number(f.byte_size) / 1024).toLocaleString()} KB</td><td><FileDownload id={f.id} /></td></tr>)}</tbody></table></div></div>}
 {loading ? <div className="skeleton" aria-busy="true" aria-label="Loading uploaded spreadsheet data"><div /></div> : error ? <div role="alert" className="error">{error}</div> : !source.total ? <Empty title="No uploaded spreadsheet rows" text="When employees attach CSV or XLSX files to a saved daily report, the structured rows will appear here automatically." /> : <>
 <div className="filterbar upload-filters column-filters">{source.headers.slice(0, 8).map((h: string) => {
          const options = [...new Set<string>(source.rows.map((r: Row) => String(r.values[h] ?? '')).filter((value: string) => Boolean(value)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          return <Field key={h} label={'Filter · ' + h}><select aria-label={'Filter · ' + h} value={columnFilters[h] || ''} onChange={e => setColumnFilters({ ...columnFilters, [h]: e.target.value })}><option value="">All {h}</option>{options.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>;
        })}</div>
 {numeric.length > 0 && rows.length > 0 && <div className="dashboard-grid upload-charts"><section className="panel"><div className="panel-heading"><div><h3>Uploaded metric by employee</h3><p>Average of the selected numeric column; units remain as supplied.</p></div><Field label="Numeric column"><select value={metric} onChange={e => setMetric(e.target.value)}>{numeric.map((n: string) => <option key={n}>{n}</option>)}</select></Field></div><div className="chart" role="img" aria-label={'Average ' + metric + ' by employee'}><ResponsiveContainer width="100%" height={260}><BarChart data={byPerson}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{
                  fontSize: 10
                }} /><YAxis /><Tooltip /><Bar dataKey="value" name={'Average ' + metric} fill="#27745f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="panel"><div className="panel-heading"><div><h3>Metric profile</h3><p>Each axis is scaled to its highest filtered value (0–100).</p></div><Field label="Employee"><select value={chosen?.id || ''} onChange={e => setRadarEmployee(e.target.value)}>{people.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>{radar.length ? <div className="chart" role="img" aria-label={'Normalized uploaded metrics for ' + (chosen?.name || 'employee')}><ResponsiveContainer width="100%" height={260}><RadarChart data={radar}><PolarGrid /><PolarAngleAxis dataKey="metric" tick={{
                  fontSize: 9
                }} /><PolarRadiusAxis domain={[0, 100]} tick={{
                  fontSize: 8
                }} /><Radar name="Relative value" dataKey="score" stroke="#27745f" fill="#73a28a" fillOpacity={0.42} /><Tooltip /></RadarChart></ResponsiveContainer></div> : <Empty title="No numeric columns" text="The uploaded table has no numeric values to chart." />}</section></div>}
 <div className="panel-heading uploaded-table-heading"><div><h3>Parsed file rows</h3><p>{source.total >= 1000 ? 'Showing up to 1,000' : rows.length + ' of ' + source.total} rows · filtering applied above</p></div></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Employee</th><th>File</th><th>Row</th>{source.headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0, 250).map((r: Row, i: number) => <tr key={r.file_id + ':' + r.row_number + ':' + i}><td>{r.date}</td><td>{r.user_name}</td><td><FileDownload id={r.file_id}>{r.file_name}</FileDownload></td><td>{r.row_number}</td>{source.headers.map((h: string) => <td key={h}>{String(r.values[h] ?? '')}</td>)}</tr>)}</tbody></table></div>{rows.length > 250 && <p className="muted small">Showing first 250 filtered rows in the table. Export the original file for full detail.</p>}
 </>}
 </section>;
}
