'use client'

import { AlertTriangle, Loader2, RefreshCw, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsDetailList } from '@/components/settings/workspace/SettingsDetailList'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import type { OperaSyncConflict } from '@/lib/api/integrations'
import {
  OPERA_NAME, connectionModeLabel, conflictResourceLabel, conflictSummary, deriveBadge, formatTimestamp, isSftpMode, safeEndpoint,
} from '@/lib/settings/integrations'
import { SessionResultLine } from './SessionResultLine'
import type { OperaIntegration } from './useOperaIntegration'

const DASH = '—'

/** Section heading used inside the drawer body. */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 id={id} className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {children}
    </section>
  )
}

export function ManageOperaDrawer({
  integration, onClose, onReview, onUpdateConnection, onDisconnect,
}: {
  integration: OperaIntegration
  onClose: () => void
  onReview: (conflict: OperaSyncConflict) => void
  onUpdateConnection: () => void
  onDisconnect: () => void
}) {
  const { status, conflicts, conflictsQuery, test, sync, busy, lastTest, lastSync } = integration
  const sftp = isSftpMode(status)
  const endpoint = safeEndpoint(status?.ohip_base_url)
  const badge = deriveBadge({
    connected: Boolean(status?.connected), testing: test.isPending, syncing: sync.isPending, disconnecting: integration.disconnect.isPending,
    openConflicts: conflicts.length, lastTest, lastSync,
  })

  return (
    <SettingsDrawer
      title={OPERA_NAME}
      description="Property Management System"
      onClose={onClose}
      width="lg"
      footer={({ requestClose }) => (
        <div className="flex justify-end px-4 py-3 sm:px-5"><Button variant="ghost" onClick={requestClose}>Close</Button></div>
      )}
    >
      <div className="space-y-6">
        <Section id="opera-manage-connection" title="Connection">
          <div className="flex flex-wrap items-center gap-2">
            <SettingsStatusPill tone={badge.tone}>{badge.label}</SettingsStatusPill>
            <span className="text-xs text-ink-3">Credentials on file; authenticated when the connection was saved.</span>
          </div>
          <SettingsDetailList
            columns={2}
            items={[
              { label: 'Property code', value: status?.opera_hotel_id || DASH, mono: true },
              { label: 'Connection type', value: connectionModeLabel(status) },
              sftp
                ? { label: 'SFTP host', value: status?.sftp_host || DASH, mono: true }
                : { label: 'Endpoint', value: endpoint ?? DASH, mono: true },
              { label: 'Connected since', value: formatTimestamp(status?.connected_since) ?? DASH },
              { label: 'Last successful sync', value: formatTimestamp(status?.last_sync_at) ?? 'No sync recorded yet' },
            ]}
          />
          <div className="space-y-1.5" aria-live="polite">
            <SessionResultLine label="Connection test" okLabel="Connection test passed" failLabel="Connection test failed" result={lastTest} pending={test.isPending} idle="Not run in this session." note="Confirms sign-in only — it doesn’t check that data syncs." />
            <SessionResultLine label="Sync" okLabel="Sync completed" failLabel="Sync failed" result={lastSync} pending={sync.isPending} idle="Not run in this session. The server doesn’t store the result of earlier syncs." />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={integration.runTest} loading={test.isPending} disabled={busy && !test.isPending}>
              <Zap size={14} aria-hidden="true" /> Test Connection
            </Button>
            <Button variant="outline" onClick={integration.runSync} loading={sync.isPending} disabled={busy && !sync.isPending}>
              <RefreshCw size={14} aria-hidden="true" /> Sync Now
            </Button>
          </div>
        </Section>

        <Section id="opera-manage-conflicts" title={`Sync conflicts${conflicts.length ? ` (${conflicts.length})` : ''}`}>
          {conflictsQuery.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading conflicts…</p>
          ) : conflictsQuery.isError ? (
            <p role="alert" className="text-sm text-[var(--alert)]">
              We couldn’t load conflicts.{' '}
              <button type="button" onClick={() => conflictsQuery.refetch()} className="font-medium underline">Try again</button>
            </p>
          ) : conflicts.length === 0 ? (
            <p className="text-sm text-ink-3">No conflicts need review.</p>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--r-md)] border border-line">
              {conflicts.map((conflict) => (
                <li key={conflict.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <AlertTriangle size={14} className="shrink-0 text-[var(--caution)]" aria-hidden="true" />
                      {conflictResourceLabel(conflict)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-2">{conflictSummary(conflict)}</p>
                    {formatTimestamp(conflict.detected_at) && <p className="mt-0.5 text-xs text-ink-3">Detected {formatTimestamp(conflict.detected_at)}</p>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onReview(conflict)} disabled={busy} aria-label={`Review conflict for ${conflictResourceLabel(conflict)}`}>
                    Review Conflict
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="opera-manage-config" title="Configuration">
          {sftp ? (
            <>
              <SettingsDetailList columns={2} items={[
                { label: 'SFTP host', value: status?.sftp_host || DASH, mono: true },
                { label: 'Remote path', value: status?.sftp_remote_path || DASH, mono: true },
              ]} />
              <p className="text-[13px] text-ink-3">Scheduled-report connection details can’t be edited here.</p>
            </>
          ) : (
            <>
              <SettingsDetailList columns={2} items={[
                { label: 'Property code', value: status?.opera_hotel_id || DASH, mono: true },
                { label: 'OHIP endpoint', value: endpoint ?? DASH, mono: true },
              ]} />
              <p className="text-[13px] text-ink-3">Stored passwords and tokens are never displayed. Updating the connection means entering its credentials again.</p>
              <Button variant="outline" onClick={onUpdateConnection} disabled={busy}>Update connection details</Button>
            </>
          )}
        </Section>

        <Section id="opera-manage-danger" title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] border border-[var(--alert-line)] p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Disconnect {OPERA_NAME}</p>
              <p className="text-[13px] text-ink-3">PatelRep will stop using this connection.</p>
            </div>
            <Button variant="destructive" onClick={onDisconnect} disabled={busy}>
              <Trash2 size={14} aria-hidden="true" /> Disconnect
            </Button>
          </div>
        </Section>
      </div>
    </SettingsDrawer>
  )
}
