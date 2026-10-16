export type ChartRow = { user_id: number; user_name: string; date: string; values: Record<string, unknown> };
export function numericCell(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function numericColumns(headers: string[], rows: ChartRow[]) {
  return headers.filter(header => rows.some(row => numericCell(row.values[header]) !== null));
}
export function aggregateUploadRows(rows: ChartRow[], metric: string, grouping: string, aggregation: 'sum' | 'average') {
  const groups = new Map<string, { name: string; total: number; count: number }>();
  for (const row of rows) {
    const value = numericCell(row.values[metric]);
    if (value === null) continue;
    const key = grouping === 'employee' ? String(row.user_id) : grouping === 'date' ? row.date : String(row.values[grouping.slice(7)] ?? '').trim() || 'Unspecified';
    const name = grouping === 'employee' ? row.user_name : key;
    const entry = groups.get(key) || { name, total: 0, count: 0 };
    entry.total += value;
    entry.count++;
    groups.set(key, entry);
  }
  return [...groups.values()].map(entry => ({ name: entry.name, value: aggregation === 'average' ? entry.total / entry.count : entry.total, count: entry.count }));
}
