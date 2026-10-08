'use client'

import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Download, Printer } from 'lucide-react'
import { reportsV2Api } from '@/lib/reports/api'
import { COMPARISON_LABELS, VIEW_LABELS, describeRange } from '@/lib/reports/filters'
import { exportFilename, exportOptionState, type ExportTarget } from '@/lib/reports/exportOptions'
import { FieldLabel, ReportModal, field, primaryButton, secondaryButton } from './ReportModal'
import { useReports } from './ReportsContext'

type Format = 'pdf' | 'csv' | 'print'

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const { view, allowedViews, filters, setPrintOptions } = useReports()
  const [report, setReport] = useState<ExportTarget>(view ?? allowedViews[0])
  const [format, setFormat] = useState<Format>('pdf')
  const [includeCharts, setIncludeCharts] = useState(true)
  const [includeDefinitions, setIncludeDefinitions] = useState(true)
  const [includeComparison, setIncludeComparison] = useState(filters.compare !== 'none')
  const [includeExceptions, setIncludeExceptions] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const state = exportOptionState({ format, report, currentView: view, compare: filters.compare })
  const selectedReport = state.report
  const comparisonOn = includeComparison && state.comparisonAvailable
  const effectiveFilters = comparisonOn ? filters : { ...filters, compare: 'none' as const }
  const canExportAll = allowedViews.length > 1
  const reportLabel = selectedReport === 'all' ? 'All authorized reports' : VIEW_LABELS[selectedReport]

  const chosen = {
    charts: state.chartsApply && includeCharts,
    comparison: comparisonOn,
    exceptions: includeExceptions,
    definitions: includeDefinitions,
  }

  const summary = [
    reportLabel,
    format === 'print' ? 'Print-friendly' : format.toUpperCase(),
    selectedReport === 'all' ? `ZIP · ${allowedViews.length} reports` : null,
    describeRange(filters),
    comparisonOn ? `compared with: ${COMPARISON_LABELS[filters.compare].toLowerCase()}` : 'no comparison',
    [chosen.charts && 'charts', chosen.definitions && 'metric definitions', chosen.exceptions && 'exceptions'].filter(Boolean).join(', ') || 'data only',
  ]
    .filter(Boolean)
    .join(' · ')

  async function submit() {
    setError(null)
    if (format === 'print') {
      onClose()
      // The options are applied by the components themselves (state, not CSS), then the browser prints the page.
      setTimeout(() => {
        flushSync(() => setPrintOptions(chosen))
        window.addEventListener('afterprint', () => setPrintOptions(null), { once: true })
        window.print()
      }, 150)
      return
    }
    setBusy(true)
    try {
      const path = reportsV2Api.exportPath(selectedReport, format, effectiveFilters, {
        include_charts: chosen.charts,
        include_definitions: includeDefinitions,
        include_exceptions: includeExceptions,
      })
      const blob = await reportsV2Api.download(path)
      saveBlob(blob, exportFilename(selectedReport, format, filters))
      onClose()
    } catch {
      setError(
        selectedReport === 'all'
          ? 'The reports could not be exported. Nothing was downloaded; check your access and try again.'
          : 'The export could not be created. Check that you still have access to this report and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReportModal
      title="Export Report"
      description="Download a report using your selected reporting period and filters."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryButton} onClick={submit} disabled={busy}>
            {format === 'print' ? <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {busy ? 'Preparing…' : format === 'print' ? 'Print' : 'Export Report'}
          </button>
        </>
      }
    >
      <FieldLabel
        label="Report"
        hint={
          state.reportLocked
            ? 'Printing uses the report currently on screen.'
            : selectedReport === 'all'
              ? `One ${format.toUpperCase()} file per report you can access, delivered as a ZIP archive.`
              : undefined
        }
      >
        <select className={field} value={selectedReport} disabled={state.reportLocked} onChange={(e) => setReport(e.target.value as ExportTarget)}>
          {allowedViews.map((v) => (
            <option key={v} value={v}>{VIEW_LABELS[v]}{v === view ? ' (current)' : ''}</option>
          ))}
          {canExportAll && <option value="all">All authorized reports ({allowedViews.length})</option>}
        </select>
      </FieldLabel>

      <fieldset>
        <legend className="text-[12.5px] font-medium text-ink2">Format</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {([['pdf', 'PDF'], ['csv', 'CSV'], ['print', 'Print-friendly']] as const).map(([id, label]) => (
            <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-[var(--r-md)] border px-3 py-2 text-[13px] ${format === id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-ink' : 'border-line text-ink2'}`}>
              <input type="radio" name="export-format" value={id} checked={format === id} onChange={() => setFormat(id)} className="accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[12.5px] font-medium text-ink2">Options</legend>
        <div className="mt-1 space-y-1.5 text-[13px] text-ink2">
          <label className={`flex items-center gap-2 ${state.chartsApply ? '' : 'opacity-50'}`}>
            <input type="checkbox" checked={state.chartsApply && includeCharts} disabled={!state.chartsApply} onChange={(e) => setIncludeCharts(e.target.checked)} className="accent-[var(--accent)]" />
            Include charts <span className="text-ink3">(PDF and print only)</span>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeDefinitions} onChange={(e) => setIncludeDefinitions(e.target.checked)} className="accent-[var(--accent)]" /> Include metric definitions</label>
          <label className={`flex items-center gap-2 ${state.comparisonAvailable ? '' : 'opacity-50'}`}>
            <input type="checkbox" checked={comparisonOn} disabled={!state.comparisonAvailable} onChange={(e) => setIncludeComparison(e.target.checked)} className="accent-[var(--accent)]" />
            Include comparison period {!state.comparisonAvailable && <span className="text-ink3">(turn on a comparison in the filters)</span>}
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeExceptions} onChange={(e) => setIncludeExceptions(e.target.checked)} className="accent-[var(--accent)]" /> Include exception summaries</label>
        </div>
      </fieldset>

      <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-[12.5px] text-ink2" aria-live="polite">
        <p className="mb-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink3">Preview</p>
        {summary}
      </div>
      {error && <p role="alert" className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-ink">{error}</p>}
    </ReportModal>
  )
}
