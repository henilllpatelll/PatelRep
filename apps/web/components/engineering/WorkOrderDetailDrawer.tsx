'use client'

import { useTranslation } from 'react-i18next'
import type { WorkOrder } from '@/lib/api/engineering'
import type { RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import { WorkOrderRecord } from './WorkOrderRecord'
import { EngineeringDrawer } from './EngineeringDrawer'

interface Props {
  wo: WorkOrder | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  startInEditMode?: boolean
  autoAction?: 'complete' | 'hold' | 'cancel' | 'reopen'
  roomUnavailability?: RoomUnavailabilityPeriod | null
}

/** Drawer shell only: WorkOrderRecord remains the single reusable record body. */
export function WorkOrderDetailDrawer({ wo, isOpen, onClose, onUpdate, startInEditMode, autoAction, roomUnavailability }: Props) {
  const { t } = useTranslation()
  if (!wo) return null
  return (
    <EngineeringDrawer
      open={isOpen}
      title={t('engineering.workOrderDetail.drawerTitle', { number: wo.work_order_number })}
      label={t('engineering.workOrderDetail.ariaLabel', { number: wo.work_order_number })}
      closeLabel={t('engineering.workOrderDetail.closeDrawer')}
      onClose={onClose}
      width="wide"
    >
      <div className="-mx-5 -my-5 flex h-[calc(100%+2.5rem)] sm:-mx-6">
        <WorkOrderRecord wo={wo} onClose={onClose} onUpdate={onUpdate} startInEditMode={startInEditMode} autoAction={autoAction} roomUnavailability={roomUnavailability} />
      </div>
    </EngineeringDrawer>
  )
}
