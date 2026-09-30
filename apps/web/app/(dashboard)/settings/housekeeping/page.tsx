'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { CleaningChecklistEditor } from '@/components/settings/CleaningChecklistEditor'
import { HousekeepingWorkloadSettings } from '@/components/settings/HousekeepingWorkloadSettings'
import { AssignmentPreferencesSettings } from '@/components/settings/AssignmentPreferencesSettings'

export default function HousekeepingSettingsPage() {
  const { t } = useTranslation()
  const { isGM, role } = useRole()
  const [tab, setTab] = useState<'cleaning' | 'workload' | 'assignment'>('cleaning')
  const canManage = isGM || role === 'housekeeping_supervisor'

  if (!canManage) {
    return (
      <p className="text-sm text-ink3 py-8">{t('housekeeping.settings.permissionDenied')}</p>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">{t('housekeeping.settings.title')}</h2>
        <p className="text-sm text-ink3 mt-1">{t('housekeeping.settings.description')}</p>
      </div>
      <div role="tablist" aria-label={t('housekeeping.settings.title')} className="flex border-b border-line">
        {(['cleaning', 'workload', 'assignment'] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === item ? 'border-accent text-accent' : 'border-transparent text-ink3 hover:text-ink'}`}>
            {t(`housekeeping.settings.tabs.${item}`)}
          </button>
        ))}
      </div>
      {tab === 'cleaning' && <CleaningChecklistEditor />}
      {tab === 'workload' && <HousekeepingWorkloadSettings />}
      {tab === 'assignment' && <AssignmentPreferencesSettings />}
    </div>
  )
}
