import { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { callingFields, callingColumns, callingValueCounts, filterCallingRows, type CallingRow, type CallingFilters, type CallingField } from '../shared/calling-data';
import { Empty, Field } from './components';

export default function CallingDataInsights({ headers, rows }: { headers: string[]; rows: CallingRow[] }) {
  const [filters, setFilters] = useState<CallingFilters>({});
  const columns = useMemo(() => callingColumns(headers), [headers]);
  const options = useMemo(() => Object.fromEntries(callingFields.map(field => [field.id, callingValueCounts(rows, columns, field.id)])), [rows, columns]);
  const filtered = useMemo(() => filterCallingRows(rows, columns, filters), [rows, columns, filters]);
  const activeFilters = Object.values(filters).filter(value => value !== undefined).length;
  const change = (field: CallingField, value: string) => setFilters(current => {
    const next = { ...current };
    if (value === 'all') delete next[field];
    else next[field] = value === 'blank' ? null : value.slice(6);
    return next;
  });
  return <div className="calling-data-insights">
    <div className="panel-heading"><div><h3>Calling data filters</h3><p>Filter the attributes inside the selected files. All five filters work together.</p></div>{activeFilters > 0 && <button type="button" className="text-button" onClick={() => setFilters({})}>Reset calling filters</button>}</div>
    <div className="filterbar upload-filters calling-filters">{callingFields.map(field => <Field key={field.id} label={field.label}><select value={filters[field.id] === undefined ? 'all' : filters[field.id] === null ? 'blank' : 'value:' + filters[field.id]} onChange={e => change(field.id, e.target.value)}><option value="all">All {field.label.toLowerCase()} values</option>{options[field.id].map(option => <option key={option.value === null ? 'blank' : 'value:' + option.value} value={option.value === null ? 'blank' : 'value:' + option.value}>{option.label}</option>)}</select></Field>)}</div>
    <p className="muted small" role="status">Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} calling records. Graphs count records across all selected files.</p>
    {!filtered.length ? <Empty title={rows.length ? 'No matching calling records' : 'No calling records in these files'} text={rows.length ? 'Change a filter or reset the calling filters to see the graphs.' : 'Select a file containing calling records.'} /> : <div className="dashboard-grid upload-charts">{callingFields.map(field => {
      const values = callingValueCounts(filtered, columns, field.id).map(entry => ({ name: entry.label, count: entry.count }));
      return <section className="panel" key={field.id}><h3>Records by {field.label.toLowerCase()}</h3><div className="chart" role="img" aria-label={`${filtered.length} filtered calling records by ${field.label.toLowerCase()}`}><ResponsiveContainer width="100%" height={Math.max(260, values.length * 36)}><BarChart data={values} layout="vertical" margin={{ left: 0, right: 20 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} tickFormatter={(value: string) => value.length > 24 ? value.slice(0, 23) + '…' : value} /><Tooltip /><Bar dataKey="count" name="Records" fill="var(--green)" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></section>;
    })}</div>}
  </div>;
}
