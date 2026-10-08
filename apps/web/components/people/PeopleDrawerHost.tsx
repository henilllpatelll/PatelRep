'use client'

import { useCallback, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import type { Department, StaffMember } from '@/lib/api/staff'
import type { DirectoryEntry, InvitationEntry, StaffEntry, TodayState } from '@/lib/people/peopleDirectory'
import { backTarget, type DrawerView } from '@/lib/people/peopleDrawers'
import { PeopleConfirmDialog, PeopleDrawerShell } from './PeopleDrawerShell'
import { Banner } from './PeopleFormFields'
import { InvitationDetailsView, InvitationEditView } from './InvitationViews'
import { CoverageView } from './CoverageView'
import { ManageAccessView } from './ManageAccessView'
import { InviteView, CreateAccountView } from './OnboardingViews'
import { PersonEditView } from './PersonEditView'
import { PersonProfileView } from './PersonProfileView'
import type { Notice, ViewCommon } from './peopleView'
import { usePeopleLabels, type TodaySource } from './usePeopleLabels'

interface Props {
  view: DrawerView | null
  setView: (v: DrawerView | null) => void
  directory: DirectoryEntry[]
  directoryLoaded: boolean
  staffList: StaffMember[]
  departments: Department[]
  today: Map<string, TodayState> | undefined
  todaySource: TodaySource
  selfUserId: string | null
  isGM: boolean
  notify: (n: Notice) => void
  onDeactivate: (s: StaffMember) => void
  onReactivate: (s: StaffMember) => void
  onRevoke: (e: InvitationEntry) => void
}

const STAFF_VIEWS = new Set(['profile', 'edit', 'access', 'coverage'])
const INVITATION_VIEWS = new Set(['invitation', 'editInvitation'])

/**
 * The single People drawer. It owns which internal view is showing and the unsaved-changes guard, so
 * every path out (Back, Close, Escape, backdrop, switching views) asks before discarding work.
 */
export function PeopleDrawerHost(props: Props) {
  const { view, setView, directory, directoryLoaded } = props
  const { t, displayName } = usePeopleLabels()
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null)
  const dirtyRef = useRef<{ dirty: boolean; kind: 'form' | 'credentials' }>({ dirty: false, kind: 'form' })
  const [pending, setPending] = useState<{ target: DrawerView | null; kind: 'form' | 'credentials' } | null>(null)

  const apply = useCallback((target: DrawerView | null) => {
    dirtyRef.current = { dirty: false, kind: 'form' }
    setPending(null)
    setView(target)
  }, [setView])

  const request = useCallback((target: DrawerView | null) => {
    if (dirtyRef.current.dirty) setPending({ target, kind: dirtyRef.current.kind })
    else apply(target)
  }, [apply])

  const onDirty = useCallback((dirty: boolean, kind: 'form' | 'credentials' = 'form') => {
    dirtyRef.current = { dirty, kind }
  }, [])

  if (!view) return null

  const back = backTarget(view)
  const entry = 'key' in view ? directory.find((e) => e.key === view.key) : undefined
  const wantsStaff = STAFF_VIEWS.has(view.view)
  const wantsInvitation = INVITATION_VIEWS.has(view.view)
  const matched = entry && ((wantsStaff && entry.kind === 'staff') || (wantsInvitation && entry.kind === 'invitation')) ? entry : undefined

  const common: ViewCommon = {
    footerEl,
    onDirty,
    onView: (v) => request(v),
    onBack: () => request(back),
    onClose: () => request(null),
    notify: props.notify,
  }

  const titles: Record<DrawerView['view'], string> = {
    profile: t('people.drawer.titles.profile'),
    edit: t('people.drawer.titles.edit'),
    access: t('people.drawer.titles.access'),
    coverage: t('people.drawer.titles.coverage'),
    invitation: t('people.drawer.titles.invitation'),
    editInvitation: t('people.drawer.titles.editInvitation'),
    invite: t('people.drawer.titles.invite'),
    create: t('people.drawer.titles.create'),
  }
  const viewKey = 'key' in view ? `${view.view}:${view.key}` : view.view

  let body: React.ReactNode
  if ('key' in view && !matched) {
    body = !directoryLoaded ? (
      <div className="space-y-3" aria-busy="true"><Skeleton className="h-14 w-full" /><Skeleton className="h-40 w-full" /></div>
    ) : (
      <div className="space-y-4">
        <Banner tone="info">{t('people.drawer.unavailable')}</Banner>
        <Button variant="outline" className="w-full justify-center" onClick={() => request(null)}>{t('people.drawer.close')}</Button>
      </div>
    )
  } else if (matched?.kind === 'staff') {
    const s: StaffEntry = matched
    const staff = s.staff
    switch (view.view) {
      case 'profile':
        body = (
          <PersonProfileView
            entry={s}
            staffList={props.staffList}
            selfUserId={props.selfUserId}
            isGM={props.isGM}
            today={props.today?.get(staff.user_id)}
            todaySource={props.todaySource}
            onView={common.onView}
            onDeactivate={props.onDeactivate}
            onReactivate={props.onReactivate}
          />
        )
        break
      case 'edit':
        body = <PersonEditView {...common} staff={staff} departments={props.departments} canEditRate={props.isGM} />
        break
      case 'access':
        body = <ManageAccessView {...common} staff={staff} staffList={props.staffList} selfUserId={props.selfUserId} />
        break
      case 'coverage':
        body = <CoverageView {...common} staff={staff} />
        break
    }
  } else if (matched?.kind === 'invitation') {
    const inv: InvitationEntry = matched
    body = view.view === 'editInvitation'
      ? <InvitationEditView {...common} entry={inv} departments={props.departments} />
      : <InvitationDetailsView {...common} entry={inv} onRevoke={props.onRevoke} />
  } else if (view.view === 'invite') {
    body = <InviteView {...common} departments={props.departments} />
  } else if (view.view === 'create') {
    body = <CreateAccountView {...common} departments={props.departments} />
  }

  return (
    <>
      <PeopleDrawerShell
        title={titles[view.view]}
        eyebrow={matched && view.view !== 'profile' && view.view !== 'invitation' ? displayName(matched) : undefined}
        viewKey={viewKey}
        onClose={() => request(null)}
        onBack={back ? () => request(back) : undefined}
        footerRef={setFooterEl}
      >
        <div key={viewKey}>{body}</div>
      </PeopleDrawerShell>

      {pending && (
        <PeopleConfirmDialog
          title={pending.kind === 'credentials' ? t('people.discard.credentialsTitle') : t('people.discard.title')}
          body={<p>{pending.kind === 'credentials' ? t('people.discard.credentialsBody') : t('people.discard.body')}</p>}
          confirmLabel={pending.kind === 'credentials' ? t('people.discard.leave') : t('people.discard.confirm')}
          cancelLabel={t('people.discard.keep')}
          tone="destructive"
          onConfirm={() => apply(pending.target)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  )
}
