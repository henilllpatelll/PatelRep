import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DetailItem { label: string; value: ReactNode; mono?: boolean }

/** Read-only label/value pairs. Missing values should be passed as a neutral "—" or short phrase, never invented. */
export function SettingsDetailList({ items, columns = 1, className }: { items: DetailItem[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{item.label}</dt>
          <dd className={cn('mt-0.5 break-words text-sm text-ink', item.mono && 'font-mono text-[13px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
