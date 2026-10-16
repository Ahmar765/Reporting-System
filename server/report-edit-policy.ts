type ReportEditState = { status: string; employee_edit_count?: number; employee_edit_open?: number };

export function canChangeReport(report: ReportEditState) {
  return report.status === 'draft' || report.status === 'correction_requested'
    && report.employee_edit_count === 1 && report.employee_edit_open === 1;
}

export function canStartReportEdit(report: ReportEditState) {
  return ['submitted', 'corrected', 'approved', 'correction_requested'].includes(report.status)
    && (report.employee_edit_count || 0) === 0 && (report.employee_edit_open || 0) === 0;
}
