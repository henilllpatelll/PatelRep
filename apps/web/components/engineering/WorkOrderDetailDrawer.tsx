'use client'

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkOrder } from '@/lib/api/engineering'
import { WorkOrderRecord } from './WorkOrderRecord'

interface Props {
  wo: WorkOrder | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  startInEditMode?: boolean
  /** Pre-opens the matching inline action (kanban drag-to-column shortcuts) instead of a silent status change, since hold/cancel/reopen require a reason and completion requires notes/labor/parts. */
  autoAction?: 'complete' | 'hold' | 'cancel' | 'reopen'
  roomUnavailabilityReason?: string | null
}

export function WorkOrderDetailDrawer({ wo, isOpen, onClose, onUpdate, startInEditMode, autoAction, roomUnavailabilityReason }: Props) {
  const { t } = useTranslation()
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen && drawerRef.current) drawerRef.current.focus()
  }, [isOpen])

  if (!isOpen || !wo) return null

  return (
    <>
      {/* Scrim -- solid rgba per the design, no blur */}
      <div
        className="fixed inset-0 bg-[rgba(26,24,21,0.28)] z-drawer transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer -- solid panel + pop shadow per the design, not frosted glass */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('engineering.workOrderDetail.ariaLabel', { number: wo.work_order_number })}
        className="fixed right-0 top-0 h-full w-[484px] max-w-full border-l border-line bg-surface shadow-[var(--shadow-pop)] z-drawer flex flex-col outline-none"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms cubic-bezier(.2,.7,.3,1)' }}
      >
        <WorkOrderRecord
          wo={wo}
          onClose={onClose}
          onUpdate={onUpdate}
          startInEditMode={startInEditMode}
          autoAction={autoAction}
          roomUnavailabilityReason={roomUnavailabilityReason}
        />
      </div>
    </>
  )
}
