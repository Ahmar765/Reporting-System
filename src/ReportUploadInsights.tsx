import { FileDownload } from './FileDownload';
import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { api, type Row } from './api';
import { Empty, Field } from './components';
import { callingColumns, isCallingData, type CallingRow } from '../shared/calling-data';
import CallingDataInsights from './CallingDataInsights';
export default function ReportUploadInsights({
  reportId
}: {
  reportId: number;
}) {
  const [source, setSource] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [fileId, setFileId] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [metric, setMetric] = useState('');
  const load = () => {
    setError('');
    setSource(null);
    api('/reports/' + reportId + '/upload-data').then((result: Row) => {
      setSource(result);
      setFileId(String(result.files[0]?.id || ''));
      setColumnFilters({});
      setMetric(result.headers.find((h: string) => result.rows.some((r: Row) => r.values[h] !== '' && Number.isFinite(Number(r.values[h])))) || '');
    }).catch((e: Error) => setError(e.message));
  };
  useEffect(load, [reportId]);
  const files: Row[] = source?.files || [];
  const selectedFile = fileId || String(files[0]?.id || '');
  const selected = files.find(f => String(f.id) === selectedFile);
  const fileRows: (Row & CallingRow)[] = useMemo(() => (source?.rows || []).filter((r: Row) => !fileId || String(r.file_id) === fileId), [source, fileId]);
  const rows: Row[] = useMemo(() => fileRows.filter((r: Row) => Object.entries(columnFilters).every(([key, value]) => !value || String(r.values[key] ?? '') === value)), [fileRows, columnFilters]);
  const columnOptions = useMemo(() => Object.fromEntries((selected?.columns || source?.headers || []).slice(0, 8).map((header: string) => [header, [...new Set<string>(fileRows.map((r: Row) => String(r.values[header] ?? '')).filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }))])), [fileRows, selected, source]);
  const headers: string[] = selected?.columns || source?.headers || [];
  const numeric = headers.filter(h => rows.some(r => r.values[h] !== '' && Number.isFinite(Number(r.values[h]))));
  const activeMetric = numeric.includes(metric) ? metric : numeric[0] || '';
  const labelColumn = headers.find(h => !numeric.includes(h));
  const bars = rows.slice(0, 20).map((r: Row) => ({
    name: String(labelColumn ? r.values[labelColumn] || 'Row ' + r.row_number : 'Row ' + r.row_number).slice(0, 28),
    value: Number(r.values[activeMetric]) || 0
  })).filter(r => Number.isFinite(r.value));
  const radar = numeric.slice(0, 8).map(name => {
    const values = rows.map((r: Row) => Number(r.values[name])).filter((n: number) => Number.isFinite(n));
    const average = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
    const maximum = values.length ? Math.max(...values) : 0;
    return {
      metric: name,
      value: maximum > 0 ? Math.round(average / maximum * 100) : 0,
      average
    };
  });
  if (source && !error && isCallingData(callingColumns(headers))) return <section className="panel uploaded-insights report-upload-insights"><div className="panel-heading"><div><span className="eyebrow">DAILY REPORT DATA</span><h2>Uploaded file dashboard</h2><p>Calling records attached to this report.</p></div></div><div className="filterbar"><Field label="Uploaded file"><select value={selectedFile} onChange={e => setFileId(e.target.value)}>{files.map(file => <option key={file.id} value={file.id}>{file.original_name}</option>)}</select></Field></div><CallingDataInsights key={selectedFile} headers={headers} rows={fileRows} /></section>;
  return <section className="panel uploaded-insights report-upload-insights"><div className="panel-heading"><div><span className="eyebrow">DAILY REPORT DATA</span><h2>Uploaded file dashboard</h2><p>Parsed spreadsheet data attached to this report. The radar scales each metric relative to its highest row value.</p></div><span className="badge">{rows.length} rows</span></div>
 {error ? <div role="alert" className="error">{error}<button type="button" className="secondary" onClick={load}>Retry</button></div> : !source ? <div className="skeleton" aria-busy="true" aria-label="Loading report spreadsheet data"><div /></div> : !files.length ? <Empty title="No files attached" text="CSV and XLSX files attached to this report will appear here with their parsed data." /> : <>
 <div className="filterbar upload-filters"><Field label="Uploaded file"><select value={selectedFile} onChange={e => { setFileId(e.target.value); setColumnFilters({}); }}>{files.map(f => <option key={f.id} value={f.id}>{f.original_name} · {f.row_count ? f.row_count + ' rows' : 'attachment'}</option>)}</select></Field>{headers.slice(0, 8).map(h => <Field key={h} label={'Filter · ' + h}><select aria-label={'Filter · ' + h} value={columnFilters[h] || ''} onChange={e => setColumnFilters({ ...columnFilters, [h]: e.target.value })}><option value="">All {h}</option>{(columnOptions[h] || []).map((value: string) => <option key={value} value={value}>{value}</option>)}</select></Field>)}</div>
 {!rows.length ? <Empty title="No parsed spreadsheet rows" text="This report may only contain document attachments, or the selected filters returned no data." /> : <>
 {numeric.length > 0 && <div className="dashboard-grid upload-charts"><section className="panel"><div className="panel-heading"><div><h3>Uploaded metric</h3><p>First 20 rows for the selected numeric column.</p></div><Field label="Numeric column"><select value={activeMetric} onChange={e => setMetric(e.target.value)}>{numeric.map(n => <option key={n}>{n}</option>)}</select></Field></div><div className="chart" role="img" aria-label={'Uploaded ' + activeMetric + ' by row'}><ResponsiveContainer width="100%" height={260}><BarChart data={bars}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{
                    fontSize: 10
                  }} /><YAxis /><Tooltip /><Bar dataKey="value" name={activeMetric} fill="#27745f" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="panel"><div className="panel-heading"><div><h3>Metric profile</h3><p>Average values scaled from 0 to 100 within this file.</p></div></div><div className="chart" role="img" aria-label="Normalized averages for uploaded metrics"><ResponsiveContainer width="100%" height={260}><RadarChart data={radar}><PolarGrid /><PolarAngleAxis dataKey="metric" tick={{
                    fontSize: 9
                  }} /><PolarRadiusAxis domain={[0, 100]} tick={{
                    fontSize: 8
                  }} /><Radar name="Relative average" dataKey="value" stroke="#27745f" fill="#73a28a" fillOpacity={0.42} /><Tooltip /></RadarChart></ResponsiveContainer></div></section></div>}
 <div className="table-scroll"><table><thead><tr><th>Row</th>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0, 250).map((r: Row) => <tr key={r.file_id + ':' + r.row_number}><td>{r.row_number}</td>{headers.map(h => <td key={h}>{String(r.values[h] ?? '')}</td>)}</tr>)}</tbody></table></div>{rows.length > 250 && <p className="muted small">Showing first 250 filtered rows. Use the original attachment for the full spreadsheet.</p>}
 </>}
 <div className="compact-list report-file-list">{files.map(f => <div key={f.id}><strong>{f.original_name}</strong><span>{f.extension.toUpperCase()} · {Math.round(Number(f.byte_size) / 1024).toLocaleString()} KB · {f.row_count || 0} rows · <FileDownload id={f.id} /></span></div>)}</div>
 </>}
 </section>;
}
