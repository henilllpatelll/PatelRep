'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { StaffMember } from '@/lib/api/staff'
import type { Priority } from '@/lib/api/tasks'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { bulkPriorityOptions, canBulkAssign, canBulkCancel, canBulkSetPriority, splitByEligibility } from '@/lib/utils/taskBulkActions'
import { Button, IconButton } from '@/components/ui/Button'
import { AssigneePicker } from './AssigneePicker'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'

type PendingConfirm =
  | { kind: 'assign'; staff: StaffMember; eligible: UnifiedTaskItem[]; ineligibleCount: number }
  | { kind: 'priority'; priority: Priority; eligible: UnifiedTaskItem[]; ineligibleCount: number }
  | { kind: 'cancel'; eligible: UnifiedTaskItem[]; ineligibleCount: number }

export function BulkActionBar({
  selectedItems, staff, workloadByAssignee, canAssign, canManage, onAssign, onSetPriority, onCancel, onClear, busy,
}: {
  selectedItems: UnifiedTaskItem[]
  staff: StaffMember[]
  workloadByAssignee: Map<string, number>
  canAssign: boolean
  canManage: boolean
  onAssign: (staff: StaffMember, eligible: UnifiedTaskItem[]) => void
  onSetPriority: (priority: Priority, eligible: UnifiedTaskItem[]) => void
  onCancel: (eligible: UnifiedTaskItem[]) => void
  onClear: () => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  if (selectedItems.length === 0) return null

  function handleAssignPick(member: StaffMember) {
    const { eligible, ineligible } = splitByEligibility(selectedItems, canBulkAssign)
    if (eligible.length === 0) return
    if (ineligible.length === 0) onAssign(member, eligible)
    else setPending({ kind: 'assign', staff: member, eligible, ineligibleCount: ineligible.length })
  }

  function handlePriorityPick(priority: Priority) {
    setPriorityOpen(false)
    const { eligible, ineligible } = splitByEligibility(selectedItems, (item) => canBulkSetPriority(item, priority))
    if (eligible.length === 0) return
    if (ineligible.length === 0) onSetPriority(priority, eligible)
    else setPending({ kind: 'priority', priority, eligible, ineligibleCount: ineligible.length })
  }

  function handleCancelClick() {
    const { eligible, ineligible } = splitByEligibility(selectedItems, canBulkCancel)
    if (eligible.length === 0) return
    setPending({ kind: 'cancel', eligible, ineligibleCount: ineligible.length })
  }

  function confirmPending() {
    if (!pending) return
    if (pending.kind === 'assign') onAssign(pending.staff, pending.eligible)
    else if (pending.kind === 'priority') onSetPriority(pending.priority, pending.eligible)
    else onCancel(pending.eligible)
    setPending(null)
  }

  const assignEligibleCount = selectedItems.filter(canBulkAssign).length
  const cancelEligibleCount = selectedItems.filter(canBulkCancel).length
  const priorityOptions = bulkPriorityOptions(selectedItems)

  return (
    <>
      <div className="shrink-0 flex flex-wrap items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-2.5">
        <span className="text-sm font-semibold text-accent">{t('tasks.bulk.selectedCount', { count: selectedItems.length })}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {canAssign && (
            <div title={assignEligibleCount === 0 ? t('tasks.bulk.noneAssignable') : undefined}>
              <AssigneePicker
                staff={staff}
                value=""
                disabled={busy || assignEligibleCount === 0}
                onChange={(userId) => {
                  const member = staff.find((s) => s.user_id === userId)
                  if (member) handleAssignPick(member)
                }}
                workloadByAssignee={workloadByAssignee}
                unassignedLabel={t('tasks.bulk.assignAction')}
              />
            </div>
          )}
          {canManage && (
            <div className="relative">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPriorityOpen((v) => !v)} aria-expanded={priorityOpen} aria-haspopup="menu">
                {t('tasks.bulk.priorityAction')}
              </Button>
              {priorityOpen && (
                <div role="menu" className="absolute left-0 z-30 mt-1.5 w-40 rounded-[var(--r-md)] border border-line bg-surface p-1.5 shadow-pop">
                  {priorityOptions.map((priority) => (
                    <button key={priority} type="button" role="menuitem" onClick={() => handlePriorityPick(priority)} className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-ink hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                      {t(`tasks.priorities.${priority}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canManage && (
            <Button type="button" size="sm" variant="outline" disabled={busy || cancelEligibleCount === 0} onClick={handleCancelClick} title={cancelEligibleCount === 0 ? t('tasks.bulk.noneCancellable') : undefined}>
              {t('tasks.bulk.cancelAction')}
            </Button>
          )}
        </div>
        <IconButton type="button" variant="ghost" size="sm" onClick={onClear} aria-label={t('tasks.bulk.clearSelection')} className="ml-auto">
          <X size={15} />
        </IconButton>
      </div>

      <DeleteConfirmDialog
        open={pending?.kind === 'cancel'}
        title={t('tasks.bulk.cancelConfirmTitle', { count: pending?.kind === 'cancel' ? pending.eligible.length : 0 })}
        description={
          pending?.kind === 'cancel' && pending.ineligibleCount > 0
            ? t('tasks.bulk.cancelConfirmDescriptionPartial', { count: pending.ineligibleCount })
            : t('tasks.bulk.cancelConfirmDescription')
        }
        confirmLabel={t('tasks.bulk.cancelConfirmButton', { count: pending?.kind === 'cancel' ? pending.eligible.length : 0 })}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
        loading={busy}
      />
      <DeleteConfirmDialog
        open={pending?.kind === 'assign' || pending?.kind === 'priority'}
        title={t('tasks.bulk.partialConfirmTitle')}
        description={
          pending && pending.kind !== 'cancel'
            ? t('tasks.bulk.partialConfirmDescription', { ineligible: pending.ineligibleCount, eligible: pending.eligible.length })
            : undefined
        }
        confirmLabel={t('tasks.bulk.partialConfirmButton')}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
        loading={busy}
      />
    </>
  )
}
