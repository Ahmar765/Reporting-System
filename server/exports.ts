import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { writeWorkbook } from './xlsx.js';
import { DateTime } from './calendar.js';
import type { summary } from './domain.js';
export const safeCell = (v: unknown) => {
  const text = String(v ?? '');
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
};
export const csvCell = (v: unknown) => '"' + safeCell(v).replaceAll('"', '""') + '"';
type Summary = ReturnType<typeof summary> & {
  role_name: string;
};
export async function download(req: Request, res: Response, results: Summary[]) {
  const format = String(req.params.format);
  if (!['csv', 'xlsx', 'pdf'].includes(format)) {
    res.status(400).json({
      error: 'Choose CSV, XLSX, or PDF.'
    });
    return;
  }
  const dataset = String(req.query.dataset || 'activities');
  if (!['activities', 'kpis', 'summaries'].includes(dataset)) {
    res.status(400).json({
      error: 'Unknown export dataset.'
    });
    return;
  }
  const generated = new Date().toISOString();
  const start = String(req.query.start || results[0]?.start || '');
  const end = String(req.query.end || results[0]?.end || '');
  const metadata = {
    Generated: generated,
    Period: start + ' to ' + end,
    Employee: req.query.user || 'Authorized team',
    Role: req.query.role || 'All authorized roles',
    Category: req.query.category || 'All authorized categories',
    Status: req.query.status || 'All statuses'
  };
  let rows: unknown[][] = [];
  if (dataset === 'activities') rows = [['Employee', 'Role', 'Date', 'Report status', 'Category', 'KPI / activity', 'Actual', 'Unit', 'Outcome', 'Minutes', 'Evidence', 'Notes'], ...results.flatMap(s => s.activities.map(a => [s.user.name, s.role_name, a.date, a.report_status, a.category, a.kpi_name || a.title, a.actual, a.unit, a.outcome, a.minutes, a.evidence, a.notes]))];
  if (dataset === 'kpis') rows = [['Employee', 'Role', 'KPI', 'Frequency', 'Effective start', 'Effective end', 'Period target', 'Actual', 'Unit', 'Achievement %', 'Evidence', 'Weight'], ...results.flatMap(s => s.kpis.map(k => [s.user.name, s.role_name, k.name, k.frequency, k.start_date, k.end_date, k.target, k.actual, k.unit, k.achievement, k.evidence, k.weight]))];
  if (dataset === 'summaries') rows = [['Employee', 'Role', 'Start', 'End', 'Working days', 'Reports', 'Completion %', 'Compliance %', 'Score', 'Rating', 'Achievement', 'Quality', 'Impact', 'Learning', 'Explanation'], ...results.map(s => [s.user.name, s.role_name, s.start, s.end, s.workingDays, s.submitted, s.completion, s.compliance, s.score, s.rating, s.components.achievement, s.components.quality, s.components.impact, s.components.learning, s.explanation])];
  res.setHeader('Content-Disposition', 'attachment; filename="cadence-' + dataset + '-' + start + '-' + end + '.' + format + '"');
  if (format === 'csv') {
    res.type('text/csv');
    res.send('\uFEFF' + [...Object.entries(metadata).map(([k, v]) => [k, v]), [], ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
    return;
  }
  if (format === 'xlsx') {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(writeWorkbook([{
      name: 'Export information',
      rows: Object.entries(metadata)
    }, {
      name: dataset,
      rows: rows.map(r => r.map(v => typeof v === 'number' ? v : safeCell(v)))
    }]));
    return;
  }
  res.type('application/pdf');
  const doc = new PDFDocument({
    margin: 45,
    margins: {
      top: 45,
      bottom: 70,
      left: 45,
      right: 45
    },
    size: 'A4',
    bufferPages: true
  });
  doc.pipe(res);
  const line = (label: string, value: unknown) => {
    if (doc.y > 735) doc.addPage();
    doc.font(process.env.PDF_BOLD_FONT_PATH || 'Helvetica-Bold').fontSize(10).fillColor('#143d35').text(label);
    doc.font(process.env.PDF_FONT_PATH || 'Helvetica').fontSize(10).fillColor('#263832').text(String(value ?? 'Pending evidence'), {
      width: 500
    });
    doc.moveDown(.5);
  };
  doc.fontSize(24).fillColor('#143d35').text('Cadence');
  doc.fontSize(14).text('Business development performance report');
  doc.moveDown();
  for (const [k, v] of Object.entries(metadata)) line(k, v);
  for (const s of results) {
    doc.addPage();
    doc.fontSize(20).text(s.user.name);
    line('Role', s.role_name);
    line('Period', s.start + ' to ' + s.end);
    line('Performance', s.score === null ? 'Insufficient evidence' : s.score.toFixed(2) + ' / 100 · ' + s.rating);
    line('Reporting', s.submitted + ' reports / ' + s.workingDays + ' working days. Compliance: ' + (s.compliance?.toFixed(1) ?? 'Pending') + '%');
    line('Scoring model', 'Configuration #' + s.config.id + '; effective ' + s.config.effective_date + '; achievement cap ' + s.config.cap + '%. Weights: ' + JSON.stringify(s.config.weights));
    for (const [k, v] of Object.entries(s.components)) line(k, v === null ? 'Pending evidence' : Number(v).toFixed(2) + '%');
    line('Method', s.explanation);
    if (s.override) line('Administrator override', s.override.reason + ' — ' + s.override.actor);
    for (const k of s.kpis) line(k.name + ' (' + k.unit + ')', 'Target ' + k.target.toFixed(2) + '; actual ' + (k.actual ?? 'not reported') + '; achievement ' + (k.achievement?.toFixed(2) ?? 'pending') + '%; ' + k.evidence + ' evidence; ' + k.frequency + ' assignment ' + k.assignedTarget + ' ' + k.unit + '; selected period target ' + k.target + '.');
    for (const r of s.reports) {
      line('Daily report · ' + r.date, r.status + '; submitted ' + (r.submitted_at ? DateTime.fromISO(r.submitted_at).setZone('Asia/Karachi').toFormat('dd LLL yyyy HH:mm ZZZZ') : 'not submitted'));
      for (const a of s.activities.filter(a => a.report_id === r.id)) line(a.category + ' · ' + a.title, a.actual + ' ' + a.unit + '; ' + a.outcome + '; ' + a.description + '; ' + a.notes);
      for (const field of ['achievements', 'blockers', 'missed_reason', 'lessons', 'suggestions', 'next_plan', 'assistance']) if (r[field]) line(field.replaceAll('_', ' '), r[field]);
    }
    for (const f of s.feedback) line('Manager feedback · ' + f.actor, f.comment + '\nImprovement plan: ' + f.improvement_plan);
    if (s.reflection) line('Employee reflection', s.reflection.self_assessment + '\nNext period: ' + s.reflection.next_plan);
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#666666').text('Confidential · Cadence · ' + (i + 1) + ' / ' + pages.count, 45, 790, {
      lineBreak: false
    });
  }
  doc.end();
}
