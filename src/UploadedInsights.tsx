import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, LineChart, Line } from 'recharts';
import { api, type Row } from './api';
import { Field, Empty } from './components';
import { aggregateUploadRows, numericColumns, type ChartRow } from '../shared/upload-charts';

export default function UploadedInsights({ data, filters }: { data: Row; filters: Row }) {
  const [source, setSource] = useState<Row>({ files: [], headers: [], rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [metric, setMetric] = useState('');
  const [aggregation, setAggregation] = useState<'sum' | 'average'>('sum');
  const [grouping, setGrouping] = useState('employee');
  const [range, setRange] = useState({ start: filters.start || '', end: filters.end || '', user: String(filters.user || ''), role: String(filters.role || ''), category: String(filters.category || '') });
  useEffect(() => {
    setRange({ start: filters.start || '', end: filters.end || '', user: String(filters.user || ''), role: String(filters.role || ''), category: String(filters.category || '') });
    setSelection([]);
  }, [filters.start, filters.end, filters.user, filters.role, filters.category]);
  const query = useMemo(() => {
    const params = new URLSearchParams(Object.entries(range).filter(([, value]) => value));
    if (selection.length) params.set('files', selection.join(','));
    else params.set('metadata', '1');
    return params.toString();
  }, [range, selection]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api('/admin/upload-data?' + query).then((result: Row) => {
      if (!active) return;
      setSource(result);
      if (selection.some(id => !result.files.some((file: Row) => file.id === id))) setSelection(current => current.filter(id => result.files.some((file: Row) => file.id === id)));
    }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);
  const rows = source.rows as ChartRow[];
  const numeric = numericColumns(source.headers, rows);
  const activeMetric = numeric.includes(metric) ? metric : numeric[0] || '';
  const textColumns = (source.headers as string[]).filter(header => !numeric.includes(header));
  const activeGrouping = grouping.startsWith('column:') && !textColumns.includes(grouping.slice(7)) ? 'employee' : grouping;
  const chart = aggregateUploadRows(rows, activeMetric, activeGrouping, aggregation);
  const trend = aggregateUploadRows(rows, activeMetric, 'date', aggregation).sort((a, b) => a.name.localeCompare(b.name));
  const selectedFiles = (source.files as Row[]).filter(file => selection.includes(file.id));
  const changeRange = (key: keyof typeof range, value: string) => { setRange(current => ({ ...current, [key]: value })); setSelection([]); };
  const toggle = (id: string) => setSelection(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 100 ? [...current, id] : current);
  return <section className="panel uploaded-insights"><div className="panel-heading"><div><span className="eyebrow">SPREADSHEET INSIGHTS</span><h2>Uploaded file graphs</h2><p>Select a file to view its graphs. Select several files to combine their values in the same graphs.</p></div></div>
    <div className="filterbar upload-filters"><Field label="From"><input type="date" value={range.start} onChange={e => changeRange('start', e.target.value)} /></Field><Field label="To"><input type="date" value={range.end} onChange={e => changeRange('end', e.target.value)} /></Field><Field label="Employee"><select value={range.user} onChange={e => changeRange('user', e.target.value)}><option value="">All employees</option>{data.users.map((user: Row) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field><Field label="Role"><select value={range.role} onChange={e => changeRange('role', e.target.value)}><option value="">All roles</option>{data.roles.map((role: Row) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field><Field label="Category"><select value={range.category} onChange={e => changeRange('category', e.target.value)}><option value="">All categories</option>{data.categories.map((category: Row) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field></div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="panel-heading"><h3>Choose uploaded files</h3>{selection.length > 0 && <button type="button" className="text-button" onClick={() => setSelection([])}>Clear selection ({selection.length})</button>}</div>
    <div className="file-chart-picker" aria-label="Uploaded files">{source.files.map((file: Row) => <label className={'file-chart-choice' + (selection.includes(file.id) ? ' selected' : '')} key={file.id}><input type="checkbox" checked={selection.includes(file.id)} disabled={loading || selection.length >= 100 && !selection.includes(file.id)} onChange={() => toggle(file.id)} /><span><strong>{file.original_name}</strong><small>{file.user_name} · {file.date} · {String(file.extension).toUpperCase()}</small></span></label>)}</div>
    {loading ? <div className="skeleton" aria-busy="true" aria-label="Loading file graphs"><div /></div> : error ? null : !source.files.length ? <Empty title="No submitted files in this period" text="Adjust the filters to find employee uploads." /> : !selection.length ? <Empty title="Select files to see graphs" text="Choose one file above, or select multiple files for collective graphs. Up to 100 files can be combined." /> : !numeric.length ? <Empty title="No numeric data to chart" text="Graphs are available for numeric columns in CSV and XLSX files. Select a spreadsheet containing numeric values." /> : <>
      <div className="panel-heading chart-selection-summary"><div><h3>{selectedFiles.length === 1 ? selectedFiles[0].original_name : `Collective graphs · ${selectedFiles.length} files`}</h3><p>{aggregation === 'sum' ? 'Values are added across all selected files.' : 'Values are averaged across all selected rows, including every selected file.'} Blank and nonnumeric cells are excluded. Columns with the same name should use the same units.</p></div></div>
      <div className="filterbar"><Field label="Numeric column"><select value={activeMetric} onChange={e => setMetric(e.target.value)}>{numeric.map(header => <option key={header}>{header}</option>)}</select></Field><Field label="Combine values"><select value={aggregation} onChange={e => setAggregation(e.target.value as 'sum' | 'average')}><option value="sum">Total</option><option value="average">Average</option></select></Field><Field label="Group bars by"><select value={activeGrouping} onChange={e => setGrouping(e.target.value)}><option value="employee">Employee</option><option value="date">Report date</option>{textColumns.map(header => <option key={header} value={'column:' + header}>{header}</option>)}</select></Field></div>
      <div className="dashboard-grid upload-charts"><section className="panel"><h3>{aggregation === 'sum' ? 'Total' : 'Average'} {activeMetric}</h3><div className="chart" role="img" aria-label={`${aggregation === 'sum' ? 'Total' : 'Average'} ${activeMetric} across ${selectedFiles.length} selected files`}><ResponsiveContainer width="100%" height={300}><BarChart data={chart}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="value" name={activeMetric} fill="#27745f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
        <section className="panel"><h3>{activeMetric} by report date</h3><p className="muted small">Combined {aggregation === 'sum' ? 'total' : 'average'} for all selected files on each report date.</p><div className="chart" role="img" aria-label={`${activeMetric} by report date for the selected files`}><ResponsiveContainer width="100%" height={300}><LineChart data={trend}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Line dataKey="value" name={activeMetric} stroke="#27745f" strokeWidth={2} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div></section></div>
    </>}
  </section>;
}
