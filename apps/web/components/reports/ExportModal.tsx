'use client'

import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { reportsV2Api } from '@/lib/reports/api'
import { COMPARISON_LABELS, VIEW_LABELS, describeRange, type ReportView } from '@/lib/reports/filters'
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
  const { view, allowedViews, filters } = useReports()
  const [report, setReport] = useState<ReportView>(view ?? allowedViews[0])
  const [format, setFormat] = useState<Format>('pdf')
  const [includeCharts, setIncludeCharts] = useState(true)
  const [includeDefinitions, setIncludeDefinitions] = useState(true)
  const [includeComparison, setIncludeComparison] = useState(filters.compare !== 'none')
  const [includeExceptions, setIncludeExceptions] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chartsApply = format !== 'csv'
  const effectiveFilters = includeComparison ? filters : { ...filters, compare: 'none' as const }
  const reportLocked = format === 'print'
  const selectedReport = reportLocked && view ? view : report

  const summary = [
    VIEW_LABELS[selectedReport],
    format === 'print' ? 'Print-friendly' : format.toUpperCase(),
    describeRange(filters),
    includeComparison && filters.compare !== 'none' ? `compared with: ${COMPARISON_LABELS[filters.compare].toLowerCase()}` : 'no comparison',
    [chartsApply && includeCharts && 'charts', includeDefinitions && 'metric definitions', includeExceptions && 'exceptions'].filter(Boolean).join(', ') || 'data only',
  ].join(' · ')

  async function submit() {
    setError(null)
    if (format === 'print') {
      onClose()
      // Let the modal unmount before the browser snapshots the page for printing.
      setTimeout(() => window.print(), 150)
      return
    }
    setBusy(true)
    try {
      const path = reportsV2Api.exportPath(selectedReport, format, effectiveFilters, {
        include_charts: chartsApply && includeCharts,
        include_definitions: includeDefinitions,
        include_exceptions: includeExceptions,
      })
      const blob = await reportsV2Api.download(path)
      saveBlob(blob, `patelrep-${selectedReport}-${filters.start}-to-${filters.end}.${format}`)
      onClose()
    } catch {
      setError('The export could not be created. Check that you still have access to this report and try again.')
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
      <FieldLabel label="Report" hint={reportLocked ? 'Printing uses the report currently on screen.' : undefined}>
        <select className={field} value={selectedReport} disabled={reportLocked} onChange={(e) => setReport(e.target.value as ReportView)}>
          {allowedViews.map((v) => (
            <option key={v} value={v}>{VIEW_LABELS[v]}{v === view ? ' (current)' : ''}</option>
          ))}
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
          <label className={`flex items-center gap-2 ${chartsApply ? '' : 'opacity-50'}`}>
            <input type="checkbox" checked={chartsApply && includeCharts} disabled={!chartsApply} onChange={(e) => setIncludeCharts(e.target.checked)} className="accent-[var(--accent)]" />
            Include charts <span className="text-ink3">(PDF and print only)</span>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeDefinitions} onChange={(e) => setIncludeDefinitions(e.target.checked)} className="accent-[var(--accent)]" /> Include metric definitions</label>
          <label className={`flex items-center gap-2 ${filters.compare === 'none' ? 'opacity-50' : ''}`}>
            <input type="checkbox" checked={includeComparison && filters.compare !== 'none'} disabled={filters.compare === 'none'} onChange={(e) => setIncludeComparison(e.target.checked)} className="accent-[var(--accent)]" />
            Include comparison period {filters.compare === 'none' && <span className="text-ink3">(turn on a comparison in the filters)</span>}
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
