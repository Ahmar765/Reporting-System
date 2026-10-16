import { useMemo, useState } from 'react';
import { callingFields, callingColumns, callingValueCounts, callingGraphs, filterCallingRows, type CallingRow, type CallingFilters, type CallingField } from '../shared/calling-data';
import { Empty, Field } from './components';
import CallingGraph from './CallingGraph';

export default function CallingDataInsights({ headers, rows }: { headers: string[]; rows: CallingRow[] }) {
  const [filters, setFilters] = useState<CallingFilters>({});
  const columns = useMemo(() => callingColumns(headers), [headers]);
  const options = useMemo(() => Object.fromEntries(callingFields.map(field => [field.id, callingValueCounts(rows, columns, field.id)])), [rows, columns]);
  const filtered = useMemo(() => filterCallingRows(rows, columns, filters), [rows, columns, filters]);
  const graphs = useMemo(() => callingGraphs(filtered, columns), [filtered, columns]);
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
    {!filtered.length ? <Empty title={rows.length ? 'No matching calling records' : 'No calling records in these files'} text={rows.length ? 'Change a filter or reset the calling filters to see the graphs.' : 'Select a file containing calling records.'} /> : <div className="dashboard-grid upload-charts">{graphs.map(graph => <CallingGraph key={graph.id} graph={graph} />)}</div>}
  </div>;
}
