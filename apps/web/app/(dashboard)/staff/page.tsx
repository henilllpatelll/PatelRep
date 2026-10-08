'use client'

import { Suspense, useState, useMemo, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus, X, Mail, AlertTriangle } from 'lucide-react'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRefreshPeople } from '@/components/people/usePeopleData'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { SectionLabel } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { useHotelStore } from '@/stores/hotelStore'
import { schedulingApi } from '@/lib/api/scheduling'
import { useAuthStore } from '@/stores/authStore'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  DEFAULT_FILTERS, buildDirectory, buildTodayMap, decodeFilters, encodeFilters, filterDirectory, hasActiveFilters,
  hotelToday, sortDirectory, summarize, type DirectoryEntry, type DirectoryFilters, type InvitationEntry, type SortKey,
} from '@/lib/people/peopleDirectory'
import type { DrawerView } from '@/lib/people/peopleDrawers'
import { PeopleDirectorySkeleton, PeopleDirectoryTable, PeopleMobileCards } from '@/components/people/PeopleDirectory'
import { PeopleFilters } from '@/components/people/PeopleFilters'
import { PeopleInviteMenu } from '@/components/people/PeopleInviteMenu'
import { PeopleSummary } from '@/components/people/PeopleSummary'
import { PeopleDrawerHost } from '@/components/people/PeopleDrawerHost'
import { PeopleConfirmDialog } from '@/components/people/PeopleDrawerShell'
import type { RowActionHandlers } from '@/components/people/PeopleRowActions'
import { usePeopleLabels, type TodaySource } from '@/components/people/usePeopleLabels'

// Person profile, onboarding, access, coverage and invitation management all live in the one People drawer
// (components/people/PeopleDrawerHost.tsx); this page owns the directory, its filters and the lifecycle confirmations.

function StaffPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isGM } = useRole()
  const authLoading = useAuthStore((s) => s.isLoading)
  const refreshPeople = useRefreshPeople()
  const { t, roleLabel } = usePeopleLabels()
  const hotel = useHotelStore((s) => s.hotel)
  const hotelId = hotel?.id ?? null
  const selfUserId = useAuthStore((s) => s.user?.id ?? null)

  const [drawerView, setDrawerView] = useState<DrawerView | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<StaffMember | null>(null)
  const [confirmReactivate, setConfirmReactivate] = useState<StaffMember | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<InvitationEntry | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // ── Filter state: initialised from, and written back to, the URL (defaults omitted) ──
  const [filters, setFilters] = useState<DirectoryFilters>(() => decodeFilters(new URLSearchParams(searchParams.toString())))
  const [searchInput, setSearchInput] = useState(filters.q)
  const patchFilters = (patch: Partial<DirectoryFilters>) => setFilters((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === searchInput ? f : { ...f, q: searchInput })), 200)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    const qs = encodeFilters(filters)
    if (qs !== window.location.search.replace(/^\?/, '')) router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [filters, pathname, router])

  // A department id from another hotel must not survive a hotel switch.
  const lastHotel = useRef(hotelId)
  useEffect(() => {
    if (lastHotel.current !== hotelId) {
      lastHotel.current = hotelId
      setFilters((f) => (f.department ? { ...f, department: '' } : f))
      setNotice(null)
      setDrawerView(null)
      setConfirmDeactivate(null)
      setConfirmReactivate(null)
      setConfirmRevoke(null)
    }
  }, [hotelId])

  useEffect(() => {
    if (notice?.tone !== 'success') return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  // ── Data: every key is scoped to the active hotel; no per-person requests ──
  const enabled = isGM && !!hotelId
  const staffQuery = useQuery({
    queryKey: ['staff', 'directory', hotelId],
    queryFn: () => staffApi.list({ status: 'all' }),
    select: (res) => res.data.staff,
    enabled,
  })
  const invitationsQuery = useQuery({
    queryKey: ['staff-invitations', 'open', hotelId],
    queryFn: () => staffApi.listInvitations('open'),
    select: (res) => res.data.invitations,
    enabled,
  })
  const departmentsQuery = useQuery({
    queryKey: ['people-departments', hotelId],
    queryFn: () => staffApi.listDepartments(),
    select: (res) => res.data,
    enabled,
    staleTime: 300_000,
  })
  const todayDate = hotelToday(hotel?.timezone)
  const todayQuery = useQuery({
    queryKey: ['people-today', hotelId, todayDate],
    queryFn: () => schedulingApi.listAssignments({ work_date: todayDate as string }),
    select: (res) => res.data,
    enabled: enabled && !!todayDate,
    staleTime: 60_000,
  })

  const departments = departmentsQuery.data
  const personName = (s: StaffMember) => s.preferred_name || s.full_name || s.email
  const departmentNames = useMemo(
    () => Object.fromEntries((departments ?? []).map((d) => [d.id, d.name])),
    [departments],
  )
  const directory = useMemo(
    () => (staffQuery.data ? buildDirectory(staffQuery.data, invitationsQuery.data ?? [], departmentNames) : []),
    [staffQuery.data, invitationsQuery.data, departmentNames],
  )
  const todayMap = useMemo(() => (todayQuery.data ? buildTodayMap(todayQuery.data) : undefined), [todayQuery.data])

  const source = (q: { isLoading: boolean; isError: boolean }, missing = false): TodaySource =>
    q.isError || missing ? 'error' : q.isLoading ? 'loading' : 'ready'
  const sources = {
    staff: source(staffQuery),
    invitations: source(invitationsQuery),
    // Without a valid hotel timezone we cannot say what "today" is, so the schedule is unavailable.
    today: source(todayQuery, !todayDate),
  }
  const summary = summarize(staffQuery.data, invitationsQuery.data, todayMap)

  const departmentOptions = useMemo(() => {
    const byId = new Map<string, string>((departments ?? []).map((d) => [d.id, d.name]))
    for (const e of directory) if (e.departmentId && e.departmentName && !byId.has(e.departmentId)) byId.set(e.departmentId, e.departmentName)
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [departments, directory])

  const visible = useMemo(
    () => sortDirectory(filterDirectory(directory, filters, roleLabel), filters, roleLabel),
    [directory, filters, roleLabel],
  )

  const clearFilters = () => { setSearchInput(''); setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir }) }
  const onSort = (key: SortKey) =>
    setFilters((f) => ({ ...f, sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc' }))

  // ── Mutations ──
  const fail = (err: unknown) =>
    setNotice({ tone: 'error', text: (err as Error)?.message || t('people.feedback.actionFailed') })

  const deactivateMutation = useMutation({
    mutationFn: (staff: StaffMember) => staffApi.deactivate(staff.user_id),
    onSuccess: async (_res, staff) => {
      await refreshPeople()
      setNotice({ tone: 'success', text: t('people.feedback.deactivated', { name: personName(staff) }) })
      setConfirmDeactivate(null)
    },
    onError: async () => { await refreshPeople() },
  })
  const reactivateMutation = useMutation({
    mutationFn: (staff: StaffMember) => staffApi.reactivate(staff.user_id),
    onSuccess: async (_res, staff) => {
      await refreshPeople()
      setNotice({ tone: 'success', text: t('people.feedback.reactivated', { name: personName(staff) }) })
      setConfirmReactivate(null)
    },
    onError: async () => { await refreshPeople() },
  })
  const resendMutation = useMutation({
    mutationFn: (entry: InvitationEntry) => staffApi.resendInvitation(entry.invitation.id),
    onMutate: (entry) => setBusyKey(entry.key),
    onSuccess: async (res) => {
      await refreshPeople()
      setNotice(deliveryNotice(res.data.email, res.data.delivery.status))
    },
    onError: fail,
    onSettled: () => setBusyKey(null),
  })
  const revokeMutation = useMutation({
    mutationFn: (entry: InvitationEntry) => staffApi.revokeInvitation(entry.invitation.id),
    onSuccess: async (_res, entry) => {
      await refreshPeople()
      setNotice({ tone: 'success', text: t('people.feedback.revoked', { email: entry.email }) })
      setConfirmRevoke(null)
      setDrawerView((v) => (v && 'key' in v && v.key === entry.key ? null : v))
    },
    // A race (already accepted or revoked elsewhere) is reported by the API; refresh so the directory tells the truth.
    onError: async () => { await refreshPeople() },
  })

  // Wording follows what the email provider actually reported - never assume delivery.
  function deliveryNotice(email: string, status: string | null) {
    if (status === 'failed') return { tone: 'warning' as const, text: t('people.feedback.emailFailed', { email }) }
    if (status === 'existing_account') return { tone: 'warning' as const, text: t('people.feedback.existingAccount', { email }) }
    return { tone: 'success' as const, text: t('people.feedback.emailRequested', { email }) }
  }

  const open = (view: DrawerView) => setDrawerView(view)
  const handlers: RowActionHandlers = {
    context: { selfUserId, staff: staffQuery.data ?? [] },
    onProfile: (e) => open({ view: 'profile', key: e.key }),
    onEdit: (e) => open({ view: 'edit', key: e.key }),
    onAccess: (e) => open({ view: 'access', key: e.key }),
    onSchedule: () => router.push('/scheduling'),
    onDeactivate: (e) => { deactivateMutation.reset(); setConfirmDeactivate(e.staff) },
    onReactivate: (e) => { reactivateMutation.reset(); setConfirmReactivate(e.staff) },
    onInvitation: (e) => open({ view: 'invitation', key: e.key }),
    onResend: (e) => resendMutation.mutate(e),
    onEditInvitation: (e) => open({ view: 'editInvitation', key: e.key }),
    onReissue: (e) => open({ view: 'invitation', key: e.key }),
    onRevoke: (e) => { revokeMutation.reset(); setConfirmRevoke(e) },
  }
  const openEntry = (e: DirectoryEntry) => open({ view: e.kind === 'staff' ? 'profile' : 'invitation', key: e.key })

  // ── Access: wait for auth to resolve before deciding anything ──
  if (authLoading || (isGM && !hotelId)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-14 w-full" />
        <Card className="p-0"><PeopleDirectorySkeleton /></Card>
      </div>
    )
  }
  if (!isGM) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
          <AlertTriangle className="h-6 w-6 text-ink-3" />
        </div>
        <p className="text-sm font-medium text-ink-2">{t('people.restricted.title')}</p>
        <p className="mt-1 text-xs text-ink-3">{t('people.restricted.body')}</p>
      </div>
    )
  }

  const noPeopleAtAll = !!staffQuery.data && directory.length === 0
  const filtersActive = hasActiveFilters(filters)
  const openInvite = () => open({ view: 'invite' })

  return (
    <div className="space-y-5" data-i18n-skip="true">
      <PageHeader
        dataI18nSkip
        title={t('people.title')}
        subtitle={t('people.subtitle')}
        tabs={[
          { label: t('people.tabs.team'), active: true, dataI18nSkip: true },
          { label: t('people.tabs.schedule'), active: false, onClick: () => router.push('/scheduling'), dataI18nSkip: true },
        ]}
        actions={<PeopleInviteMenu onInvite={openInvite} onCreateManually={() => open({ view: 'create' })} />}
      />

      <PeopleSummary
        summary={summary}
        sources={sources}
        onShowPending={() => { setSearchInput(''); setFilters({ ...DEFAULT_FILTERS, status: 'invited' }) }}
      />

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${
            notice.tone === 'success'
              ? 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]'
              : notice.tone === 'warning'
                ? 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]'
                : 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('people.feedback.dismiss')} className="shrink-0 rounded p-0.5 hover:opacity-70">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Partial failures: keep the directory usable and say exactly what is missing. */}
      {staffQuery.data && invitationsQuery.isError && (
        <PartialWarning text={t('people.errors.invitations')} onRetry={() => invitationsQuery.refetch()} />
      )}
      {staffQuery.data && todayQuery.isError && (
        <PartialWarning text={t('people.errors.today')} onRetry={() => todayQuery.refetch()} />
      )}

      <PeopleFilters
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        onChange={patchFilters}
        onClear={clearFilters}
        departments={departmentOptions}
        showUnassigned={directory.some((e) => !e.departmentId)}
      />

      <SectionLabel hint={staffQuery.data ? t('people.list.count', { count: visible.length }) : undefined}>
        {t('people.list.heading')}
      </SectionLabel>
      <Card className="p-0">
        {staffQuery.isLoading ? (
          <div role="status" aria-label={t('people.list.loading')}><PeopleDirectorySkeleton /></div>
        ) : staffQuery.isError ? (
          <StateBlock status="error" error={{ message: t('people.errors.load'), onRetry: () => staffQuery.refetch() }} />
        ) : noPeopleAtAll ? (
          <EmptyState
            icon={<UserPlus size={20} aria-hidden="true" />}
            title={t('people.empty.noneTitle')}
            body={t('people.empty.noneBody')}
            action={<Button variant="primary" onClick={openInvite}><Mail size={16} aria-hidden="true" />{t('people.invite.primary')}</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t('people.empty.filteredTitle')}
            body={t('people.empty.filteredBody')}
            action={filtersActive ? <Button variant="outline" onClick={clearFilters}>{t('people.filters.clear')}</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <PeopleDirectoryTable
                entries={visible} today={todayMap} todaySource={sources.today} sort={filters.sort} dir={filters.dir}
                onSort={onSort} handlers={handlers} busyKey={busyKey} onOpenEntry={openEntry}
              />
            </div>
            <div className="lg:hidden">
              <PeopleMobileCards
                entries={visible} today={todayMap} todaySource={sources.today} sort={filters.sort} dir={filters.dir}
                onSort={onSort} handlers={handlers} busyKey={busyKey} onOpenEntry={openEntry}
              />
            </div>
          </>
        )}
      </Card>

      <PeopleDrawerHost
        view={drawerView}
        setView={setDrawerView}
        directory={directory}
        directoryLoaded={!!staffQuery.data}
        staffList={staffQuery.data ?? []}
        departments={departments ?? []}
        today={todayMap}
        todaySource={sources.today}
        selfUserId={selfUserId}
        isGM={isGM}
        notify={setNotice}
        onDeactivate={(s) => { deactivateMutation.reset(); setConfirmDeactivate(s) }}
        onReactivate={(s) => { reactivateMutation.reset(); setConfirmReactivate(s) }}
        onRevoke={(e) => { revokeMutation.reset(); setConfirmRevoke(e) }}
      />

      {confirmDeactivate && (
        <PeopleConfirmDialog
          title={t('people.deactivate.title', { name: personName(confirmDeactivate) })}
          body={(
            <>
              <p>{t('people.deactivate.access')}</p>
              <p>{t('people.deactivate.history')}</p>
              <p>{t('people.deactivate.assignments')}</p>
            </>
          )}
          confirmLabel={t('people.actions.deactivate')}
          busyLabel={t('people.deactivate.busy')}
          tone="destructive"
          busy={deactivateMutation.isPending}
          error={deactivateMutation.isError ? (deactivateMutation.error as Error)?.message || t('people.feedback.actionFailed') : null}
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={() => deactivateMutation.mutate(confirmDeactivate)}
        />
      )}

      {confirmReactivate && (
        <PeopleConfirmDialog
          title={t('people.reactivate.title', { name: personName(confirmReactivate) })}
          body={(
            <>
              <p>{t('people.reactivate.access', { role: roleLabel(confirmReactivate.role) })}</p>
              <p>{t('people.reactivate.nothingElse')}</p>
            </>
          )}
          confirmLabel={t('people.actions.reactivate')}
          busyLabel={t('people.reactivate.busy')}
          busy={reactivateMutation.isPending}
          error={reactivateMutation.isError ? (reactivateMutation.error as Error)?.message || t('people.feedback.actionFailed') : null}
          onCancel={() => setConfirmReactivate(null)}
          onConfirm={() => reactivateMutation.mutate(confirmReactivate)}
        />
      )}

      {confirmRevoke && (
        <PeopleConfirmDialog
          title={t('people.revoke.title')}
          body={<p>{t('people.revoke.body', { email: confirmRevoke.email })}</p>}
          confirmLabel={t('people.revoke.confirm')}
          busyLabel={t('people.revoke.busy')}
          tone="destructive"
          busy={revokeMutation.isPending}
          error={revokeMutation.isError ? (revokeMutation.error as Error)?.message || t('people.feedback.actionFailed') : null}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => revokeMutation.mutate(confirmRevoke)}
        />
      )}
    </div>
  )
}

function PartialWarning({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] px-4 py-2.5 text-[13px] text-[var(--caution)]">
      <span className="flex items-center gap-2"><AlertTriangle size={14} aria-hidden="true" />{text}</span>
      <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">{t('common.retry')}</button>
    </div>
  )
}

export default function StaffPage() {
  // useSearchParams requires a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <StaffPageContent />
    </Suspense>
  )
}
