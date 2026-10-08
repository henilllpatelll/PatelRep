'use client'

import { Suspense, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarClock, Download, ListChecks } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { VIEW_LABELS, describeRange, type ReportView } from '@/lib/reports/filters'
import { ExportModal } from './ExportModal'
import { GuestExperienceView } from './GuestExperienceView'
import { HousekeepingView } from './HousekeepingView'
import { MaintenanceView } from './MaintenanceView'
import { ManagementView } from './ManagementView'
import { OverviewView } from './OverviewView'
import { ReportDrawerHost } from './ReportDrawerHost'
import { ErrorBlock } from './ReportPrimitives'
import { ReportsFilterBar } from './ReportsFilterBar'
import { ReportsProvider, useReports } from './ReportsContext'
import { ScheduleModal } from './ScheduleModal'
import { ScheduledReportsPanel } from './ScheduledReportsPanel'
import { TeamView } from './TeamView'

const VIEW_COMPONENTS: Record<ReportView, () => React.JSX.Element> = {
  overview: OverviewView,
  'guest-experience': GuestExperienceView,
  housekeeping: HousekeepingView,
  maintenance: MaintenanceView,
  team: TeamView,
  management: ManagementView,
}

// Print layout: hide app chrome, drawers and controls; keep headings, tables and period.
const PRINT_CSS = `
@media print {
  aside, header[class*="sticky"], nav, [data-report-drawer], [role="dialog"], .print\\:hidden { display: none !important; }
  html, body, main, div.overflow-hidden, div.overflow-y-auto { height: auto !important; overflow: visible !important; }
  main { padding: 0 !important; }
  .report-avoid-break { break-inside: avoid; page-break-inside: avoid; }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  body { background: #fff !important; color: #000 !important; }
  [data-report-print-header] { display: block !important; }
}
`

function Tabs() {
  const { allowedViews, view, setView } = useReports()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!view) return
    const index = allowedViews.indexOf(view)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % allowedViews.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + allowedViews.length) % allowedViews.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = allowedViews.length - 1
    else return
    event.preventDefault()
    setView(allowedViews[next])
    refs.current[allowedViews[next]]?.focus()
  }

  return (
    <div role="tablist" aria-label="Report views" onKeyDown={onKeyDown} className="-mb-px flex flex-wrap gap-x-1 border-b border-line print:hidden">
      {allowedViews.map((v) => {
        const active = v === view
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[v] = el
            }}
            type="button"
            role="tab"
            id={`report-tab-${v}`}
            aria-selected={active}
            aria-controls="report-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => setView(v)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${active ? 'border-[var(--accent)] text-ink' : 'border-transparent text-ink3 hover:text-ink'}`}
          >
            {VIEW_LABELS[v]}
          </button>
        )
      })}
    </div>
  )
}

function ShellBody() {
  const { ready, view, allowedViews, capabilitiesError, capabilities, filters, hotelId, role } = useReports()
  const [modal, setModal] = useState<null | 'export' | 'schedule' | 'scheduled'>(null)

  if (capabilitiesError) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Intelligence" title="Reports" subtitle="Understand performance. Find what needs attention." dataI18nSkip />
        <ErrorBlock message="Reports could not be loaded. Please refresh and try again." />
      </div>
    )
  }
  if (!ready || !hotelId || !role) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">Loading reports…</span>
        <Skeleton variant="text" className="h-9 w-48" />
        <Skeleton variant="card" className="h-16" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="card" className="h-28" />)}</div>
      </div>
    )
  }
  if (!allowedViews.length || !view) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Intelligence" title="Reports" subtitle="Understand performance. Find what needs attention." dataI18nSkip />
        <p className="rounded-[var(--r-lg)] border border-line bg-surface p-6 text-[13.5px] text-ink2">Your role does not have access to any reports.</p>
      </div>
    )
  }

  const Active = VIEW_COMPONENTS[view]
  const canExport = !!capabilities?.can_export
  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <PageHeader
        eyebrow="Intelligence"
        title="Reports"
        subtitle="Understand performance. Find what needs attention."
        dataI18nSkip
        actions={
          canExport ? (
            <>
              <button type="button" onClick={() => setModal('scheduled')} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                <ListChecks className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Scheduled</span><span className="sr-only sm:hidden">Scheduled reports</span>
              </button>
              <button type="button" onClick={() => setModal('schedule')} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                <CalendarClock className="h-4 w-4" aria-hidden="true" /> Schedule
              </button>
              <button type="button" onClick={() => setModal('export')} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--r-md)] bg-accent px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                <Download className="h-4 w-4" aria-hidden="true" /> Export
              </button>
            </>
          ) : undefined
        }
      />
      <div data-report-print-header className="hidden">
        <p className="text-[12px]">{VIEW_LABELS[view]} · {describeRange(filters)}</p>
      </div>
      <ReportsFilterBar />
      <Tabs />
      <div role="tabpanel" id="report-panel" aria-labelledby={`report-tab-${view}`} tabIndex={-1} className="min-w-0 space-y-5 outline-none">
        <Active />
      </div>
      <ReportDrawerHost />
      {modal === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {modal === 'schedule' && <ScheduleModal onClose={() => setModal(null)} />}
      {modal === 'scheduled' && <ScheduledReportsPanel onClose={() => setModal(null)} />}
    </div>
  )
}

export function ReportsShell() {
  return (
    <Suspense fallback={<Skeleton variant="card" className="h-40" />}>
      <ReportsProvider>
        <ShellBody />
      </ReportsProvider>
    </Suspense>
  )
}
