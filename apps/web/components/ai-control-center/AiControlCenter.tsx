'use client'

import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Bot } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SettingsTabPanel, SettingsTabs } from '@/components/settings/workspace/SettingsTabs'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi, type ControlCenterSection } from '@/lib/api/agentControlCenter'
import { SECTION_LABELS, resolveSection, visibleSections } from '@/lib/aiControlCenter/model'
import { isFeatureEnabled } from '@/lib/utils/featureFlag'
import { useHotelStore } from '@/stores/hotelStore'
import { errorText } from './shared'
import { OverviewSection } from './OverviewSection'
import { AgentsSection } from './AgentsSection'
import { ApprovalsSection } from './ApprovalsSection'
import { ActivitySection } from './ActivitySection'
import { ControlsSection } from './ControlsSection'
import { AuditSection } from './AuditSection'

const ID = 'ai-control-center'

/** H6 AI Control Center. Sections, buttons and every status come from the backend session and read models; the
 *  page never infers that anything is enabled. Hidden unless the hotel's `ai_control_center` flag is on. */
export function AiControlCenter() {
  const hotel = useHotelStore((s) => s.hotel)
  const flagOn = isFeatureEnabled('ai_control_center', hotel)
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const session = useQuery({
    queryKey: ['ai-control-center', 'session', hotel?.id],
    queryFn: () => agentControlCenterApi.session(),
    select: (res) => res.data,
    enabled: !!hotel?.id && flagOn,
    staleTime: 30_000,
    retry: false,
  })

  const header = (
    <PageHeader
      eyebrow="AI"
      title="AI Control Center"
      subtitle="See what PatelRep agents may do in your hotel, review their proposals, and pause them at any time."
    />
  )

  if (!flagOn) {
    return (
      <div className="space-y-6">
        {header}
        <SettingsEmpty icon={<Bot size={28} aria-hidden="true" />} title="Not available for this hotel yet"
          body="The AI Control Center is being rolled out gradually. Nothing an agent does changes while it is off." />
      </div>
    )
  }
  if (session.isPending) return <div className="space-y-6">{header}<SettingsLoading label="Checking your access…" /></div>
  if (session.isError || !session.data) {
    return (
      <div className="space-y-6">
        {header}
        <SettingsError message={errorText(session.error, 'We couldn’t open the AI Control Center.')} onRetry={() => session.refetch()} />
      </div>
    )
  }

  const sections = visibleSections(session.data.sections)
  const active = resolveSection(params.get('section'), sections)
  const select = (next: ControlCenterSection) => {
    const search = new URLSearchParams(params.toString())
    search.set('section', next)
    router.replace(`${pathname}?${search.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-6">
      {header}
      {active ? (
        <>
          <SettingsTabs idPrefix={ID} label="AI Control Center sections" value={active} onChange={select}
            tabs={sections.map((id) => ({ id, label: SECTION_LABELS[id] }))} />
          <SettingsTabPanel idPrefix={ID} tab={active}>
            {active === 'overview' && <OverviewSection onOpen={select} />}
            {active === 'agents' && <AgentsSection isGm={session.data.is_gm} />}
            {active === 'approvals' && <ApprovalsSection />}
            {active === 'activity' && <ActivitySection />}
            {active === 'controls' && <ControlsSection />}
            {active === 'audit' && <AuditSection />}
          </SettingsTabPanel>
        </>
      ) : (
        <SettingsEmpty icon={<Bot size={28} aria-hidden="true" />} title="Nothing to show for your role" body="Ask your GM if you need access." />
      )}
    </div>
  )
}
