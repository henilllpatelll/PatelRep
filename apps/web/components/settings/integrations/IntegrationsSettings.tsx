'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Link2, Loader2, RefreshCw, Settings2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsDetailList } from '@/components/settings/workspace/SettingsDetailList'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import { SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { useRole } from '@/lib/hooks/useRole'
import { errorMessage } from '@/lib/settings/apiErrors'
import type { OperaSyncConflict } from '@/lib/api/integrations'
import {
  OPERA_NAME, connectionModeLabel, deriveBadge, describeStatusProblem, formatTimestamp, isSftpMode, relativeTime,
} from '@/lib/settings/integrations'
import { ConnectOperaDrawer } from './ConnectOperaDrawer'
import { ManageOperaDrawer } from './ManageOperaDrawer'
import { ResolveConflictDialog } from './ResolveConflictDialog'
import { SessionResultLine } from './SessionResultLine'
import { useOperaIntegration } from './useOperaIntegration'

type Drawer = null | 'connect' | 'update' | 'manage'

const DASH = '—'

export function IntegrationsSettings() {
  const toast = useToast()
  const { isGM, role } = useRole()
  const integration = useOperaIntegration()
  const { statusQuery, status, connected, conflicts, conflictsQuery, test, sync, disconnect, busy, lastTest, lastSync } = integration

  const [drawer, setDrawer] = useState<Drawer>(null)
  const [resolving, setResolving] = useState<OperaSyncConflict | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  // The control that opened a drawer/dialog can disappear when the connection state flips (Connect ↔ Manage),
  // so hand focus to its replacement instead of letting it fall back to <body>.
  const [focusNext, setFocusNext] = useState<'manage' | 'connect' | null>(null)
  const manageRef = useRef<HTMLButtonElement>(null)
  const connectRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusNext === 'manage' && connected) manageRef.current?.focus()
    else if (focusNext === 'connect' && !connected) connectRef.current?.focus()
    else return
    setFocusNext(null)
  }, [focusNext, connected])

  // The API and the Settings layout already limit this to GMs; this is a last line of defence, not the control.
  if (!role) return <SettingsLoading />
  if (!isGM) return <p role="alert" className="text-sm text-ink-3">Integrations can only be managed by hotel GMs.</p>

  const conflictCount = conflictsQuery.isSuccess ? conflicts.length : null
  const badge = deriveBadge({
    connected, testing: test.isPending, syncing: sync.isPending, disconnecting: disconnect.isPending,
    openConflicts: conflicts.length, lastTest, lastSync,
  })
  const problem = statusQuery.isError ? describeStatusProblem(statusQuery.error) : null
  const lastSyncAt = status?.last_sync_at
  const lastSyncText = lastSyncAt
    ? `${formatTimestamp(lastSyncAt) ?? DASH}${relativeTime(lastSyncAt) ? ` (${relativeTime(lastSyncAt)})` : ''}`
    : 'No sync recorded yet'

  const confirmAndDisconnect = async () => {
    setDisconnectError(null)
    try {
      if (!(await integration.disconnectNow())) return
      setConfirmDisconnect(false)
      setDrawer(null)
      setFocusNext('connect')
    } catch (err) {
      setDisconnectError(errorMessage(err, 'We couldn’t disconnect OPERA Cloud. The connection was not changed.'))
    }
  }

  return (
    <div className="space-y-5">
      <SettingsSectionHeader level={1} title="Integrations" description="Connect and manage external hotel systems used by PatelRep." />

      <section aria-labelledby="connected-systems-heading" className="space-y-3">
        <h2 id="connected-systems-heading" className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Connected systems</h2>

        <SettingsCard aria-labelledby="opera-card-heading" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-2" aria-hidden="true"><Link2 size={18} /></span>
              <div className="min-w-0">
                <h3 id="opera-card-heading" className="text-base font-semibold text-ink">{OPERA_NAME}</h3>
                <p className="text-[13px] text-ink-3">Property Management System</p>
              </div>
            </div>
            {statusQuery.isPending ? (
              <Loader2 size={16} className="animate-spin text-ink-3" aria-label="Loading connection status" />
            ) : !problem ? (
              <SettingsStatusPill tone={badge.tone}>{badge.label}</SettingsStatusPill>
            ) : null}
          </div>

          {statusQuery.isPending && <SettingsLoading label="Loading connection status…" />}

          {problem && (
            <div role="alert" className="flex items-start gap-3 rounded-[var(--r-md)] border border-[var(--caution-line)] bg-[var(--caution-soft)] p-3.5">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--caution)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{problem.title}</p>
                <p className="mt-0.5 text-[13px] text-ink-2">{problem.detail}</p>
                {problem.retryable && <Button className="mt-2.5" size="sm" variant="outline" onClick={() => statusQuery.refetch()} loading={statusQuery.isFetching}>Try again</Button>}
              </div>
            </div>
          )}

          {statusQuery.isSuccess && !connected && (
            <>
              <p className="max-w-prose text-sm text-ink-2">Connect your supported OPERA Cloud property to enable the existing integration features.</p>
              <div>
                <Button ref={connectRef} onClick={() => setDrawer('connect')} disabled={busy}>Connect OPERA Cloud</Button>
              </div>
            </>
          )}

          {statusQuery.isSuccess && connected && (
            <>
              <SettingsDetailList
                columns={3}
                items={[
                  { label: 'Last successful sync', value: lastSyncText },
                  { label: 'Property code', value: status?.opera_hotel_id || DASH, mono: true },
                  {
                    label: 'Sync conflicts',
                    value: conflictsQuery.isError
                      ? <span className="text-ink-3">Unavailable</span>
                      : conflictCount === null ? <span className="text-ink-3">Checking…</span>
                      : conflictCount === 0 ? 'None'
                      : (
                        <button type="button" onClick={() => setDrawer('manage')} className="font-semibold text-[var(--caution)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                          {conflictCount} to review
                        </button>
                      ),
                  },
                ]}
              />
              {isSftpMode(status) && <p className="text-xs text-ink-3">{connectionModeLabel(status)}</p>}

              <div className="space-y-1.5" aria-live="polite">
                <SessionResultLine label="Connection test" okLabel="Connection test passed" failLabel="Connection test failed" result={lastTest} pending={test.isPending} note="Confirms sign-in only — it doesn’t check that data syncs." />
                <SessionResultLine label="Sync" okLabel="Sync completed" failLabel="Sync failed" result={lastSync} pending={sync.isPending} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={integration.runTest} loading={test.isPending} disabled={busy && !test.isPending}>
                  <Zap size={14} aria-hidden="true" /> Test Connection
                </Button>
                <Button variant="outline" onClick={integration.runSync} loading={sync.isPending} disabled={busy && !sync.isPending}>
                  <RefreshCw size={14} aria-hidden="true" /> Sync Now
                </Button>
                <Button ref={manageRef} variant="primary" onClick={() => setDrawer('manage')} disabled={disconnect.isPending}>
                  <Settings2 size={14} aria-hidden="true" /> Manage
                </Button>
              </div>
            </>
          )}
        </SettingsCard>
      </section>

      {drawer === 'connect' || drawer === 'update' ? (
        <ConnectOperaDrawer
          integration={integration}
          replacing={drawer === 'update'}
          initial={drawer === 'update' ? { ohip_base_url: status?.ohip_base_url ?? '', hotel_id_opera: status?.opera_hotel_id ?? '' } : undefined}
          onClose={() => setDrawer(null)}
          onConnected={() => { setDrawer(null); setFocusNext('manage') }}
        />
      ) : null}

      {drawer === 'manage' && connected && (
        <ManageOperaDrawer
          integration={integration}
          onClose={() => setDrawer(null)}
          onReview={setResolving}
          onUpdateConnection={() => setDrawer('update')}
          onDisconnect={() => { setDisconnectError(null); setConfirmDisconnect(true) }}
        />
      )}

      {resolving && (
        <ResolveConflictDialog
          conflict={resolving}
          integration={integration}
          onClose={() => setResolving(null)}
          onResolved={(resolution) => {
            setResolving(null)
            toast.success(resolution === 'remote_wins' ? 'Conflict resolved with the OPERA values.' : 'Conflict resolved, keeping the PatelRep values.')
          }}
        />
      )}

      {confirmDisconnect && (
        <SettingsConfirmDialog
          title={`Disconnect ${OPERA_NAME}?`}
          body={(
            <>
              <p>PatelRep will stop using this OPERA Cloud connection and clear the access tokens and passwords it stored for it.</p>
              <p>Existing operational records are not deleted and remain subject to their normal retention and access rules. You can reconnect later by entering the connection details again.</p>
            </>
          )}
          confirmLabel="Disconnect"
          tone="destructive"
          busy={disconnect.isPending}
          error={disconnectError}
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={confirmAndDisconnect}
        />
      )}
    </div>
  )
}
