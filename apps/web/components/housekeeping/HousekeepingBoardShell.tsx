'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CleanType } from '@/lib/utils/cleanType'
import type { BoardKpis, BoardStatusFilter, AttentionSummaryItem } from '@/lib/housekeeping/boardView'
import { deriveRoomAttentionItems, type HousekeepingAttentionCode, type HousekeepingOperationalRoom } from '@/lib/housekeeping/roomState'

export function BoardSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation()
  return (
    <label className="relative flex min-w-[13rem] flex-1 items-center sm:flex-none">
      <span className="sr-only">{t('housekeeping.boardV2.search.label')}</span>
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-ink3" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('housekeeping.boardV2.search.placeholder')}
        className="h-9 w-full rounded-[var(--r-md)] border border-line bg-surface py-2 pl-9 pr-8 text-sm text-ink outline-none placeholder:text-ink4 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 rounded p-0.5 text-ink3 hover:text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          aria-label={t('housekeeping.boardV2.search.clear')}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </label>
  )
}

const KPI_CONFIG: Array<{ key: keyof BoardKpis; status: BoardStatusFilter; label: string }> = [
  { key: 'needsCleaning', status: 'dirty', label: 'needsCleaning' },
  { key: 'inProgress', status: 'cleaning', label: 'inProgress' },
  { key: 'inspection', status: 'inspect', label: 'inspection' },
  { key: 'ready', status: 'ready', label: 'ready' },
  { key: 'outOfOrder', status: 'ooo', label: 'outOfOrder' },
]

export function HousekeepingSummary({
  kpis,
  activeStatus,
  onStatusChange,
}: {
  kpis: BoardKpis
  activeStatus: string | null
  onStatusChange: (status: BoardStatusFilter | null) => void
}) {
  const { t } = useTranslation()
  const supportingCopy: Record<string, string | null> = {
    needsCleaning: kpis.needsCleaningCredits > 0
      ? t('housekeeping.boardV2.summary.credits', { count: kpis.needsCleaningCredits })
      : null,
    inProgress: null,
    inspection: kpis.inspectionPriority > 0
      ? t('housekeeping.boardV2.summary.priority', { count: kpis.inspectionPriority })
      : null,
    ready: null,
    outOfOrder: kpis.outOfOrderArrivalConflict > 0
      ? t('housekeeping.boardV2.summary.arrivalConflict', { count: kpis.outOfOrderArrivalConflict })
      : null,
  }

  return (
    <section aria-label={t('housekeeping.boardV2.summary.label')} className="grid grid-cols-2 overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface sm:grid-cols-5">
      {KPI_CONFIG.map(({ key, status, label }) => {
        const selected = activeStatus === status
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            onClick={() => onStatusChange(selected ? null : status)}
            className={`min-h-[6.75rem] border-b border-line p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--accent)] sm:border-b-0 sm:border-r last:border-r-0 ${selected ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface-2'}`}
          >
            <span className="block text-xs font-medium text-ink3">{t(`housekeeping.boardV2.summary.${label}`)}</span>
            <strong className="mt-1 block font-display text-2xl font-semibold tabular-nums text-ink">{kpis[key]}</strong>
            {supportingCopy[label] && <span className="mt-1 block text-xs text-ink3">{supportingCopy[label]}</span>}
          </button>
        )
      })}
    </section>
  )
}

function attentionGroup(code: AttentionSummaryItem['code']): string {
  if (code === 'arrival_risk' || code === 'rush' || code === 'unassigned_priority_room') return 'arrival'
  if (code === 'dnd' || code === 'service_issue' || code === 'dnd_welfare_escalation' || code === 'return_later_due') return 'service'
  if (code === 'failed_inspection' || code === 'reclean') return 'quality'
  if (code === 'open_blocking_work_order' || code === 'ooo_arrival_conflict') return 'maintenance'
  return 'discrepancy'
}

function attentionLabelKey(code: AttentionSummaryItem['code']) {
  return `housekeeping.boardV2.attention.categories.${code}`
}

export function HousekeepingAttention({
  summary,
  rooms,
  activeAttention,
  onAttentionChange,
  onOpenRoom,
}: {
  summary: AttentionSummaryItem[]
  rooms: HousekeepingOperationalRoom[]
  activeAttention: HousekeepingAttentionCode | 'service_issue' | null
  onAttentionChange: (code: HousekeepingAttentionCode | 'service_issue' | null) => void
  onOpenRoom: (room: Record<string, any>) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const total = summary.reduce((count, item) => count + item.count, 0)
  const grouped = useMemo(() => {
    const byGroup = new Map<string, AttentionSummaryItem[]>()
    summary.forEach((item) => {
      const group = attentionGroup(item.code)
      byGroup.set(group, [...(byGroup.get(group) ?? []), item])
    })
    return byGroup
  }, [summary])

  return (
    <section id="housekeeping-attention" aria-labelledby="housekeeping-attention-title" className="rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="housekeeping-attention-title" className="text-sm font-semibold text-ink">{t('housekeeping.boardV2.attention.title')}</h2>
          <p className="mt-0.5 text-xs text-ink3">{t('housekeeping.boardV2.attention.itemCount', { count: total })}</p>
        </div>
        {summary.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-[var(--r-sm)] px-2 py-1 text-sm font-medium text-accent hover:bg-[var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {expanded ? t('housekeeping.boardV2.attention.hideAll') : t('housekeeping.boardV2.attention.viewAll')}
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>

      {summary.length === 0 ? (
        <p className="mt-3 text-sm text-ink3">{t('housekeeping.boardV2.attention.empty')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.map((item) => (
            <button
              key={item.code}
              type="button"
              aria-pressed={activeAttention === item.code}
              onClick={() => onAttentionChange(activeAttention === item.code ? null : item.code)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${activeAttention === item.code ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-accent' : 'border-line bg-paper text-ink2 hover:bg-surface-2'}`}
            >
              {t(attentionLabelKey(item.code))} <span className="ml-1 tabular-nums text-ink3">{item.count}</span>
            </button>
          ))}
        </div>
      )}

      {expanded && summary.length > 0 && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
          {Array.from(grouped.entries()).map(([group, items]) => {
            const relevant = rooms.filter((room) => items.some((item) => item.code === 'service_issue'
              ? room.serviceDeclined && !room.dnd
              : deriveRoomAttentionItems(room).some((attention) => attention.code === item.code)))
            if (relevant.length === 0) return null
            return (
              <div key={group}>
                <h3 className="text-xs font-medium text-ink2">{t(`housekeeping.boardV2.attention.groups.${group}`)}</h3>
                <div className="mt-2 divide-y divide-line rounded-[var(--r-md)] border border-line bg-paper">
                  {relevant.map((room) => (
                    <div key={`${group}-${room.roomId}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-ink">{room.roomNumber}</p>
                        <p className="mt-0.5 truncate text-xs text-ink3">{items.filter((item) => item.code === 'service_issue'
                          ? room.serviceDeclined && !room.dnd
                          : deriveRoomAttentionItems(room).some((attention) => attention.code === item.code))
                          .map((item) => t(attentionLabelKey(item.code))).join(', ')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenRoom(room.source)}
                        className="shrink-0 rounded-[var(--r-sm)] border border-line px-2 py-1 text-xs font-medium text-ink2 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      >
                        {t('housekeeping.boardV2.attention.openRoom')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

interface BoardFiltersProps {
  status: string | null
  building: string | null
  floor: number | null
  assigneeId: string | null
  cleanTypes: CleanType[]
  attention: HousekeepingAttentionCode | 'service_issue' | null
  unassignedOnly: boolean
  buildings: string[]
  floors: number[]
  staff: Array<{ id: string; name: string }>
  onStatusChange: (status: BoardStatusFilter | null) => void
  onBuildingChange: (building: string | null) => void
  onFloorChange: (floor: number | null) => void
  onAssigneeChange: (assigneeId: string | null) => void
  onCleanTypesChange: (cleanTypes: CleanType[]) => void
  onAttentionChange: (attention: HousekeepingAttentionCode | 'service_issue' | null) => void
  onUnassignedChange: (value: boolean) => void
}

const STATUS_FILTERS: Array<{ key: BoardStatusFilter; label: string }> = [
  { key: 'needs_action', label: 'needsAction' },
  { key: 'dirty', label: 'dirty' },
  { key: 'cleaning', label: 'cleaning' },
  { key: 'inspect', label: 'inspect' },
  { key: 'ready', label: 'ready' },
  { key: 'ooo', label: 'ooo' },
]

export function HousekeepingBoardFilters(props: BoardFiltersProps) {
  const { t } = useTranslation()
  const selectClass = 'h-9 min-w-0 rounded-[var(--r-md)] border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
  return (
    <section aria-label={t('housekeeping.boardV2.filters.label')} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((filter) => {
          const active = props.status === filter.key
          return (
            <button
              key={filter.key}
              type="button"
              aria-pressed={active}
              onClick={() => props.onStatusChange(active ? null : filter.key)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${active ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}
            >
              {t(`housekeeping.boardV2.filters.status.${filter.label}`)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {props.buildings.length > 1 && <select aria-label={t('housekeeping.boardV2.filters.building')} className={selectClass} value={props.building ?? ''} onChange={(event) => props.onBuildingChange(event.target.value || null)}>
          <option value="">{t('housekeeping.boardV2.filters.allBuildings')}</option>
          {props.buildings.map((building) => <option key={building} value={building}>{building}</option>)}
        </select>}
        <select aria-label={t('housekeeping.boardV2.filters.floor')} className={selectClass} value={props.floor ?? ''} onChange={(event) => props.onFloorChange(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{t('housekeeping.boardV2.filters.allFloors')}</option>
          {props.floors.map((floor) => <option key={floor} value={floor}>{t('housekeeping.boardV2.filters.floorOption', { floor })}</option>)}
        </select>
        <select aria-label={t('housekeeping.boardV2.filters.assignee')} className={selectClass} value={props.assigneeId ?? ''} onChange={(event) => props.onAssigneeChange(event.target.value || null)}>
          <option value="">{t('housekeeping.boardV2.filters.allAssignees')}</option>
          {props.staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <select aria-label={t('housekeeping.boardV2.filters.cleanType')} className={selectClass} value={props.cleanTypes[0] ?? ''} onChange={(event) => props.onCleanTypesChange(event.target.value ? [event.target.value as CleanType] : [])}>
          <option value="">{t('housekeeping.boardV2.filters.allCleanTypes')}</option>
          <option value="DEP">{t('housekeeping.roomStatus.filters.departure')}</option>
          <option value="FULL">{t('housekeeping.roomStatus.filters.full')}</option>
          <option value="LIGHT">{t('housekeeping.roomStatus.filters.light')}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink2">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={props.attention === 'service_issue'} onChange={(event) => props.onAttentionChange(event.target.checked ? 'service_issue' : null)} />{t('housekeeping.boardV2.filters.serviceIssues')}</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={props.attention === 'arrival_risk'} onChange={(event) => props.onAttentionChange(event.target.checked ? 'arrival_risk' : null)} />{t('housekeeping.boardV2.filters.arrivalRisk')}</label>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={props.unassignedOnly} onChange={(event) => props.onUnassignedChange(event.target.checked)} />{t('housekeeping.boardV2.filters.unassigned')}</label>
      </div>
    </section>
  )
}
