export const callingFields = [
  { id: 'owner', label: 'Owner', headers: ['owner'] },
  { id: 'remarks', label: 'Remarks', headers: ['remarks'] },
  { id: 'status', label: 'Status', headers: ['status'] },
  { id: 'response', label: 'Response', headers: ['response'] },
  { id: 'nextAction', label: 'Next action item', headers: ['nextactionitem', 'nexactionitem'] }
] as const;
export type CallingField = typeof callingFields[number]['id'];
const chartFields = [...callingFields,
  { id: 'country', headers: ['companycountry'] },
  { id: 'date', headers: ['date'] }
] as const;
export type CallingColumn = typeof chartFields[number]['id'];
export type CallingColumns = Record<CallingColumn, string[]>;
export type CallingFilters = Partial<Record<CallingField, string | null>>;
export type CallingRow = { values: Record<string, unknown> };
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const key = (value: unknown) => clean(value).toLowerCase();
export function callingColumns(headers: string[]): CallingColumns {
  return Object.fromEntries(chartFields.map(field => [field.id, headers.filter(header => {
    const normalized = header.trim().replace(/\s*\(\d+\)$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (field.headers as readonly string[]).includes(normalized);
  })])) as CallingColumns;
}
export function isCallingData(columns: CallingColumns) {
  return callingFields.every(field => columns[field.id].length > 0);
}
function fieldValues(row: CallingRow, headers: string[]) {
  const values = new Map<string, string>();
  for (const header of headers) {
    const value = clean(row.values[header]);
    if (value) values.set(key(value), values.get(key(value)) || value);
  }
  return values.size ? [...values.values()] : [''];
}
export function filterCallingRows<T extends CallingRow>(rows: T[], columns: CallingColumns, filters: CallingFilters): T[] {
  return rows.filter(row => callingFields.every(({ id }) => {
    const selected = filters[id];
    return selected === undefined || fieldValues(row, columns[id]).some(value => key(value) === key(selected));
  }));
}
export function callingValueCounts(rows: CallingRow[], columns: CallingColumns, field: CallingColumn) {
  const counts = new Map<string, { value: string | null; label: string; count: number }>();
  for (const row of rows) for (const value of fieldValues(row, columns[field])) {
    const entry = counts.get(key(value)) || { value: value || null, label: value || '(Blank)', count: 0 };
    entry.count++;
    counts.set(key(value), entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function callingDate(value: string): string | null {
  const input = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(input);
  if (!iso && !dayFirst) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(dayFirst![3]), Number(dayFirst![2]), Number(dayFirst![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export const callingGraphDefinitions = [
  { id: 'status', title: 'Call Status', field: 'status', xAxis: 'Status', yAxis: 'Number of companies/calls', kind: 'bar' },
  { id: 'response', title: 'Response Analysis', field: 'response', xAxis: 'Response', yAxis: 'Number of responses', kind: 'bar' },
  { id: 'agent', title: 'Agent Performance', field: 'owner', xAxis: 'Owner', yAxis: 'Number of calls', kind: 'bar' },
  { id: 'country', title: 'Country-wise Leads', field: 'country', xAxis: 'Company Country', yAxis: 'Number of companies', kind: 'bar' },
  { id: 'followUp', title: 'Follow-up Analysis', field: 'nextAction', xAxis: 'Next Action Item', yAxis: 'Number of leads', kind: 'bar' },
  { id: 'trend', title: 'Calling Trend', field: 'date', xAxis: 'Date', yAxis: 'Number of calls', kind: 'line' }
] as const;
export function callingGraphs(rows: CallingRow[], columns: CallingColumns) {
  const calls = rows.filter(row => fieldValues(row, columns.status).some(Boolean));
  return callingGraphDefinitions.map(graph => {
    let population = rows;
    let note = 'Each company/lead record counts once. Blank values are shown separately.';
    let data: { name: string; count: number }[];
    if (graph.id === 'trend') {
      const counts = new Map<string, number>();
      let undated = 0;
      for (const row of calls) {
        const dates = new Set(fieldValues(row, columns.date).map(callingDate).filter((date): date is string => date !== null));
        if (!dates.size) undated++;
        for (const date of dates) counts.set(date, (counts.get(date) || 0) + 1);
      }
      data = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
      note = `Calls with a recorded status, grouped by the CSV Date. ${undated} ${undated === 1 ? 'call without a valid date is' : 'calls without a valid date are'} excluded; blank dates stay undated.`;
    } else {
      if (graph.id === 'agent') {
        population = calls;
        note = 'Counts records with a recorded call status for each Owner.';
      } else if (graph.id === 'response' || graph.id === 'followUp') {
        population = rows.filter(row => fieldValues(row, columns[graph.field]).some(Boolean));
        const missing = rows.length - population.length;
        note = `${missing} ${missing === 1 ? 'record' : 'records'} without ${graph.id === 'response' ? 'a response' : 'a next action'} ${missing === 1 ? 'is' : 'are'} excluded.`;
      }
      data = callingValueCounts(population, columns, graph.field).map(entry => ({ name: entry.label, count: entry.count }));
    }
    return { ...graph, data, note, missingColumn: !columns[graph.field].length };
  });
}
export type CallingGraphData = ReturnType<typeof callingGraphs>[number];
