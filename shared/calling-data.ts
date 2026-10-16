export const callingFields = [
  { id: 'owner', label: 'Owner', headers: ['owner'] },
  { id: 'remarks', label: 'Remarks', headers: ['remarks'] },
  { id: 'status', label: 'Status', headers: ['status'] },
  { id: 'response', label: 'Response', headers: ['response'] },
  { id: 'nextAction', label: 'Next action item', headers: ['nextactionitem', 'nexactionitem'] }
] as const;
export type CallingField = typeof callingFields[number]['id'];
export type CallingColumns = Record<CallingField, string[]>;
export type CallingFilters = Partial<Record<CallingField, string | null>>;
export type CallingRow = { values: Record<string, unknown> };
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const key = (value: unknown) => clean(value).toLowerCase();
export function callingColumns(headers: string[]): CallingColumns {
  return Object.fromEntries(callingFields.map(field => [field.id, headers.filter(header => {
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
export function callingValueCounts(rows: CallingRow[], columns: CallingColumns, field: CallingField) {
  const counts = new Map<string, { value: string | null; label: string; count: number }>();
  for (const row of rows) for (const value of fieldValues(row, columns[field])) {
    const entry = counts.get(key(value)) || { value: value || null, label: value || '(Blank)', count: 0 };
    entry.count++;
    counts.set(key(value), entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
