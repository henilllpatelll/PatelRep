'use client'

import { ExternalLink, Receipt } from 'lucide-react'
import type { Invoice } from '@/lib/api/billing'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import { buildInvoiceRows, type InvoiceRow, type QueryLike } from '@/lib/settings/billing'

/** Invoice links come from the server and are only followed when they are https stripe.com addresses. */
function InvoiceLinks({ row }: { row: InvoiceRow }) {
  if (!row.viewUrl && !row.pdfUrl) return <span className="text-xs text-ink-3">Unavailable</span>
  const link = 'inline-flex min-h-[32px] items-center gap-1 rounded text-[13px] font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      {row.viewUrl && (
        <a href={row.viewUrl} target="_blank" rel="noopener noreferrer" className={link}>
          View<span className="sr-only"> invoice {row.number ?? row.date} (opens in a new tab)</span><ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      {row.pdfUrl && (
        <a href={row.pdfUrl} target="_blank" rel="noopener noreferrer" className={link}>
          Download<span className="sr-only"> PDF for invoice {row.number ?? row.date} (opens in a new tab)</span>
        </a>
      )}
    </span>
  )
}

export function InvoicesCard({ query }: { query: QueryLike<Invoice[]> }) {
  if (query.isPending) return <SettingsLoading label="Loading invoices…" />
  if (query.isError) return <SettingsError message="We couldn’t load your invoices right now." onRetry={() => query.refetch()} />
  const rows = buildInvoiceRows(query.data)
  if (rows.length === 0) {
    return <SettingsEmpty icon={<Receipt size={20} />} title="No invoices yet" body="Invoices will appear here after your first billing cycle." />
  }

  return (
    <div className="space-y-3">
      {/* Phones: one stacked entry per invoice. */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{row.date}</p>
              {row.number && <p className="text-xs text-ink-3">{row.number}</p>}
            </div>
            <p className="text-sm font-semibold tabular-nums text-ink">{row.amount}</p>
            <SettingsStatusPill tone={row.status.tone}>{row.status.label}</SettingsStatusPill>
            <div className="basis-full"><InvoiceLinks row={row} /></div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Invoices</caption>
          <thead className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-4">Date</th>
              <th scope="col" className="py-2 pr-4">Billing period</th>
              <th scope="col" className="py-2 pr-4 text-right">Amount</th>
              <th scope="col" className="py-2 pr-4">Status</th>
              <th scope="col" className="py-2">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="py-3 pr-4">
                  <span className="font-medium text-ink">{row.date}</span>
                  {row.number && <span className="block text-xs text-ink-3">{row.number}</span>}
                </td>
                <td className="py-3 pr-4 text-ink-2">{row.period ?? '—'}</td>
                <td className="py-3 pr-4 text-right font-medium tabular-nums text-ink">{row.amount}</td>
                <td className="py-3 pr-4"><SettingsStatusPill tone={row.status.tone}>{row.status.label}</SettingsStatusPill></td>
                <td className="py-3"><InvoiceLinks row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 10 && <p className="text-xs text-ink-3">Showing your 10 most recent invoices.</p>}
    </div>
  )
}
