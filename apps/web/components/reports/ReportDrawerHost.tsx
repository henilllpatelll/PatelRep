'use client'

import { useEffect, useRef } from 'react'
import { EmployeeDrawer, RoomAssetDrawer } from './EntityDrawers'
import { FilteredRecordsDrawer } from './FilteredRecordsDrawer'
import { KpiDetailDrawer } from './KpiDetailDrawer'
import { useReports } from './ReportsContext'
import { TrendComparisonDrawer } from './TrendComparisonDrawer'

/** Renders the single active drawer from URL state and returns focus to the control that opened it. */
export function ReportDrawerHost() {
  const { drawer } = useReports()
  const trigger = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const open = drawer.kind !== 'closed'

  useEffect(() => {
    if (open && !wasOpen.current && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement
    if (!open && wasOpen.current) {
      // The focus trap already restored focus from inside a single drawer; this covers drawer -> drawer chains.
      const target = trigger.current
      trigger.current = null
      if (target?.isConnected) target.focus()
    }
    wasOpen.current = open
  }, [open])

  switch (drawer.kind) {
    case 'metric-detail':
      return <KpiDetailDrawer key={`m:${drawer.metric}`} metric={drawer.metric} />
    case 'filtered-records':
      return <FilteredRecordsDrawer key={JSON.stringify([drawer.recordKind, drawer.filter, drawer.extra])} state={drawer} />
    case 'employee-performance':
      return <EmployeeDrawer key={`e:${drawer.userId}`} userId={drawer.userId} />
    case 'room-asset-performance':
      return <RoomAssetDrawer key={`r:${drawer.entity}:${drawer.id}`} entity={drawer.entity} id={drawer.id} />
    case 'trend-comparison':
      return <TrendComparisonDrawer key={`t:${drawer.metric}`} metric={drawer.metric} segment={drawer.segment} />
    default:
      return null
  }
}
