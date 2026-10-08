// Export dialog rules (pure, unit-tested): which options apply to which format, and what the file is called.
import type { ComparisonMode, ReportFilters, ReportView } from './filters'

/** One report, or every report the caller is authorised to open (delivered as a ZIP). */
export type ExportTarget = ReportView | 'all'
export type ExportFormat = 'pdf' | 'csv' | 'print'

export interface ExportOptionState {
  /** The report that will actually be produced. */
  report: ExportTarget
  /** Printing always uses the report on screen, so the picker is locked. */
  reportLocked: boolean
  /** Charts exist in PDF and print output only. */
  chartsApply: boolean
  /** A comparison can only be included if a comparison period is selected in the filters. */
  comparisonAvailable: boolean
}

export function exportOptionState(input: {
  format: ExportFormat
  report: ExportTarget
  currentView: ReportView | null
  compare: ComparisonMode
}): ExportOptionState {
  const reportLocked = input.format === 'print'
  return {
    report: reportLocked && input.currentView ? input.currentView : input.report,
    reportLocked,
    chartsApply: input.format !== 'csv',
    comparisonAvailable: input.compare !== 'none',
  }
}

export function exportFilename(report: ExportTarget, format: Exclude<ExportFormat, 'print'>, filters: Pick<ReportFilters, 'start' | 'end'>): string {
  const range = `${filters.start}-to-${filters.end}`
  return report === 'all' ? `patelrep-all-reports-${range}.zip` : `patelrep-${report}-${range}.${format}`
}
