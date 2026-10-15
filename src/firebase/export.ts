import { jsPDF } from 'jspdf';
import { loadWorkspace } from './store';
import { ClientRouter } from './router';
import { registerReportingRoutes } from './routes';
import { writeWorkbook } from './xlsx';
import { all } from './database';
import type { Row } from '../../shared/query';
const safeCell = (v: unknown) => /^[\s\u0000-\u001f]*[=+\-@]/.test(String(v ?? '')) ? "'" + String(v ?? '') : String(v ?? '');
export async function exportReport(path: string): Promise<Blob> {
  const loaded = await loadWorkspace();
  try {
    const url = new URL(path, 'https://cadence.local');
    const format = url.pathname.split('/').pop(), dataset = url.searchParams.get('dataset') || 'activities';
    if (!['csv', 'xlsx', 'pdf'].includes(format || '') || !['activities', 'kpis', 'summaries'].includes(dataset)) throw Error('Choose a supported report format and dataset.');
    const router = new ClientRouter(); registerReportingRoutes(router, loaded.db);
    const result = await router.invoke('/analytics?' + url.searchParams, 'GET', loaded.user);
    const results: Row[] = result.results;
    const metadata = { Generated: new Date().toISOString(), Period: `${result.start} to ${result.end}`, Employee: url.searchParams.get('user') || 'Authorized team', Role: url.searchParams.get('role') || 'All authorized roles', Category: url.searchParams.get('category') || 'All authorized categories', Status: url.searchParams.get('status') || 'All statuses' };
    let rows: unknown[][];
    if (dataset === 'activities') rows = [['Employee', 'Role', 'Date', 'Report status', 'Category', 'KPI / activity', 'Actual', 'Unit', 'Outcome', 'Minutes', 'Evidence', 'Notes'], ...results.flatMap(s => s.activities.map((a: Row) => [s.user.name, s.role_name, a.date, a.report_status, a.category, a.kpi_name || a.title, a.actual, a.unit, a.outcome, a.minutes, all(loaded.db, 'SELECT url FROM activity_links WHERE activity_id=? ORDER BY id', a.id).map(l => l.url).join('\n') || a.evidence, a.notes]))];
    else if (dataset === 'kpis') rows = [['Employee', 'Role', 'KPI', 'Frequency', 'Effective start', 'Effective end', 'Period target', 'Actual', 'Unit', 'Achievement %', 'Evidence', 'Weight'], ...results.flatMap(s => s.kpis.map((k: Row) => [s.user.name, s.role_name, k.name, k.frequency, k.start_date, k.end_date, k.target, k.actual, k.unit, k.achievement, k.evidence, k.weight]))];
    else rows = [['Employee', 'Role', 'Start', 'End', 'Working days', 'Reports', 'Completion %', 'Compliance %', 'Score', 'Rating', 'Achievement', 'Quality', 'Impact', 'Learning', 'Explanation'], ...results.map(s => [s.user.name, s.role_name, s.start, s.end, s.workingDays, s.submitted, s.completion, s.compliance, s.score, s.rating, s.components.achievement, s.components.quality, s.components.impact, s.components.learning, s.explanation])];
    if (format === 'csv') return new Blob(['\uFEFF' + [...Object.entries(metadata), [], ...rows].map(row => row.map(v => '"' + safeCell(v).replaceAll('"', '""') + '"').join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    if (format === 'xlsx') return new Blob([new Uint8Array(writeWorkbook([{ name: 'Export information', rows: Object.entries(metadata) }, { name: dataset, rows: rows.map(row => row.map(v => typeof v === 'number' ? v : safeCell(v))) }]))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 18;
    const line = (label: string, value: unknown, size = 10) => {
      pdf.setFontSize(size); pdf.setFont('helvetica', 'bold');
      const labelLines = pdf.splitTextToSize(label, 174) as string[];
      for (const l of labelLines) { if (y > 271) { pdf.addPage(); y = 18; } pdf.text(l, 18, y); y += 5; }
      pdf.setFont('helvetica', 'normal');
      for (const l of pdf.splitTextToSize(String(value ?? 'Pending evidence'), 174) as string[]) { if (y > 271) { pdf.addPage(); y = 18; } pdf.text(l, 18, y); y += 5; }
      y += 3;
    };
    line('Cadence', 'Business development performance report', 18);
    for (const [key, value] of Object.entries(metadata)) line(key, value);
    for (const s of results) {
      pdf.addPage(); y = 18;
      line(s.user.name, s.role_name, 16);
      line('Period', `${s.start} to ${s.end}`);
      line('Performance', s.score === null ? 'Insufficient evidence' : `${s.score.toFixed(2)} / 100 - ${s.rating}`);
      line('Reporting', `${s.submitted} reports / ${s.workingDays} working days. Compliance: ${s.compliance?.toFixed(1) ?? 'Pending'}%`);
      line('Scoring model', `#${s.config.id}; effective ${s.config.effective_date}; cap ${s.config.cap}%. Weights: ${JSON.stringify(s.config.weights)}`);
      for (const [key, value] of Object.entries(s.components)) line(key, value === null ? 'Pending evidence' : Number(value).toFixed(2) + '%');
      line('Method', s.explanation);
      if (s.override) line('Administrator override', `${s.override.reason} - ${s.override.actor}`);
      for (const k of s.kpis) line(`${k.name} (${k.unit})`, `Target ${k.target}; actual ${k.actual ?? 'not reported'}; achievement ${k.achievement ?? 'pending'}%; ${k.evidence} evidence. ${k.frequency} assigned target: ${k.assignedTarget}.`);
      for (const r of s.reports) {
        line(`Daily report - ${r.date}`, `${r.status}; submitted ${r.submitted_at || 'not submitted'}`);
        for (const a of s.activities.filter((a: Row) => a.report_id === r.id)) line(`${a.category} - ${a.title}`, `${a.actual} ${a.unit}; ${a.outcome}; ${a.description}; ${a.notes}`);
        for (const key of ['achievements', 'blockers', 'missed_reason', 'lessons', 'suggestions', 'next_plan', 'assistance']) if (r[key]) line(key.replaceAll('_', ' '), r[key]);
      }
      for (const f of s.feedback) line('Manager feedback - ' + f.actor, `${f.comment}\nImprovement plan: ${f.improvement_plan}`);
      if (s.reflection) line('Employee reflection', `${s.reflection.self_assessment}\nNext period: ${s.reflection.next_plan}`);
    }
    for (let page = 1; page <= pdf.getNumberOfPages(); page++) { pdf.setPage(page); pdf.setFontSize(8); pdf.text(`Confidential - Cadence - ${page} / ${pdf.getNumberOfPages()}`, 18, 287); }
    return pdf.output('blob');
  } finally { loaded.db.close(); }
}
