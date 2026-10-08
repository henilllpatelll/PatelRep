'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { routeHref } from '@/lib/reports/links'
import { REPORT_VIEWS, type ReportView } from '@/lib/reports/filters'
import { RECORD_KINDS, type RecordKind } from '@/lib/reports/drawerState'
import { titleCase } from '@/lib/reports/format'
import type { ExceptionItem } from '@/lib/reports/types'
import { EmptyBlock, SeverityPill } from './ReportPrimitives'
import { useReports } from './ReportsContext'

/** Prioritised "needs attention" rows. Each row is only actionable if its target is real. */
export function ReportExceptionList({ items, emptyTitle = 'Nothing needs attention right now', emptyBody }: { items: ExceptionItem[]; emptyTitle?: string; emptyBody?: string }) {
  const { openDrawer, setView, allowedViews } = useReports()
  if (!items.length) return <EmptyBlock positive title={emptyTitle} body={emptyBody ?? 'No overdue work, SLA risks or repeat issues were found for your scope.'} />

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const target = item.target
        const recordKind = target?.type === 'records' && (RECORD_KINDS as readonly string[]).includes(target.kind) ? (target.kind as RecordKind) : null
        const href = target?.type === 'route' ? routeHref(target.href) : null
        const view = target?.type === 'view' && (REPORT_VIEWS as readonly string[]).includes(target.view) && allowedViews.includes(target.view as ReportView) ? (target.view as ReportView) : null

        const content = (
          <>
            <span className="mt-0.5 shrink-0"><SeverityPill severity={item.severity} /></span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[13.5px] font-medium text-ink">
                {item.title} <span className="tabular-nums text-ink2">({item.count})</span>
              </span>
              <span className="block text-[12.5px] leading-snug text-ink3">
                {item.detail}
                {item.department ? ` · ${titleCase(item.department)}` : ''}
              </span>
            </span>
          </>
        )
        const rowClass = 'flex w-full items-start gap-3 px-1 py-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
        return (
          <li key={item.key}>
            {recordKind && target?.type === 'records' ? (
              <button
                type="button"
                className={rowClass}
                aria-label={`${item.title}, ${item.count}. Open records`}
                onClick={() =>
                  openDrawer({
                    kind: 'filtered-records',
                    recordKind,
                    filter: target.filter,
                    extra: { ...(target.priority ? { priority: target.priority } : {}), ...(target.priority_not ? { priority_not: target.priority_not } : {}) },
                    title: item.title,
                  })
                }
              >
                {content}
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink3" aria-hidden="true" />
              </button>
            ) : href ? (
              <Link href={href} className={rowClass} aria-label={`${item.title}, ${item.count}. Open ${href.slice(1)}`}>
                {content}
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink3" aria-hidden="true" />
              </Link>
            ) : view ? (
              <button type="button" className={rowClass} onClick={() => setView(view)} aria-label={`${item.title}, ${item.count}. Go to ${view} report`}>
                {content}
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink3" aria-hidden="true" />
              </button>
            ) : (
              <div className="flex items-start gap-3 px-1 py-3">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
