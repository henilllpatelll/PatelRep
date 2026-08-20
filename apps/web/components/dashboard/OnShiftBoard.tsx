'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { SectionLabel, Mono, Bar, Avatar } from '@/components/ui/primitives'
import type { ShiftTile } from '@/lib/hooks/useArrivalReadiness'

interface OnShiftBoardProps {
  tiles: ShiftTile[]
  totalOnShift: number
  behindCount: number
  otherDeptCount: number
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function OnShiftBoard({ tiles, totalOnShift, behindCount, otherDeptCount, isLoading, isError, onRetry }: OnShiftBoardProps) {
  const { t } = useTranslation()
  const status = isLoading ? 'loading' : isError ? 'error' : tiles.length === 0 ? 'empty' : null

  return (
    <Card hover={false} className="p-4">
      <SectionLabel
        hint={totalOnShift > 0 ? t('dashboard.gm.onShiftHint', { total: totalOnShift, behind: behindCount }) : undefined}
        action={
          <Link href="/staff" className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors">
            {t('nav.staff')}
          </Link>
        }
      >
        {t('dashboard.gm.onShiftTitle')}
      </SectionLabel>

      <StateBlock
        status={status}
        error={{ message: t('common.error'), onRetry }}
        empty={{ title: t('dashboard.gm.onShiftEmpty') }}
      >
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[76px] rounded-[var(--r-md)] bg-surface-3 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {tiles.map((tile) => {
                const pct = tile.assigned > 0 ? (tile.done / tile.assigned) * 100 : 0
                return (
                  <div key={tile.userId} className="border border-line-2 rounded-[var(--r-md)] px-3 py-2.5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={tile.name} size={22} />
                      <span className="text-[12.5px] font-medium text-ink flex-1 min-w-0 truncate">{tile.name}</span>
                      <Mono className="text-[11px] text-ink3">{tile.done}/{tile.assigned}</Mono>
                    </div>
                    <Bar value={pct} tone={tile.behindPace ? 'caution' : 'ready'} height={4} />
                    <span className={`text-[10.5px] ${tile.behindPace ? 'text-[var(--caution)]' : 'text-ink3'}`}>
                      {tile.behindPace
                        ? t('dashboard.gm.behindPace', { area: tile.area })
                        : t('dashboard.gm.onPace', { area: tile.area })}
                    </span>
                  </div>
                )
              })}
            </div>
            {otherDeptCount > 0 && (
              <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink3">
                <span>{t('dashboard.gm.moreOnShift', { count: otherDeptCount })}</span>
                <Link href="/scheduling" className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors">
                  {t('nav.schedule')}
                </Link>
              </div>
            )}
          </>
        )}
      </StateBlock>
    </Card>
  )
}
