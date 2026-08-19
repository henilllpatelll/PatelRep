'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Link2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Zap,
  AlertTriangle,
  BookOpen,
  ArrowRight,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { integrationsApi, type OperaConnectRequest } from '@/lib/api/integrations'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { PageHeader } from '@/components/shared/PageHeader'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  return 'just now'
}

function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-600 mb-1">
      {children}
      {required && <span className="text-[var(--alert)] ml-0.5">*</span>}
    </label>
  )
}

function CredentialInput({ v2, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { v2?: boolean }) {
  return (
    <input
      {...props}
      className={
        v2
          ? 'w-full px-3 py-2 text-sm border border-line rounded-[var(--r-md)] bg-surface transition-colors duration-fast ease-standard focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] placeholder:text-ink3'
          : 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-300 transition-colors placeholder:text-gray-400'
      }
    />
  )
}

// ─── Disconnect Confirm Dialog ────────────────────────────────────────────────

function ConfirmDisconnectDialog({
  onConfirm,
  onCancel,
  loading,
  v2,
}: {
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
  v2?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(dialogRef, true, loading ? undefined : onCancel)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={!loading ? onCancel : undefined} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        tabIndex={-1}
        className={
          v2
            ? 'relative bg-surface/[0.88] backdrop-blur-2xl border border-line rounded-[var(--r-lg)] shadow-xl p-6 w-full max-w-sm space-y-4'
            : 'relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl p-6 w-full max-w-sm space-y-4'
        }
      >
        <div className="flex items-center gap-3">
          <div className={v2 ? 'w-10 h-10 rounded-full bg-alert-soft flex items-center justify-center shrink-0' : 'w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0'}>
            <AlertTriangle size={18} className="text-[var(--alert)]" />
          </div>
          <div>
            <h3 id="disconnect-title" className={v2 ? 'text-base font-semibold text-ink' : 'text-base font-semibold text-gray-900'}>Disconnect Opera Cloud</h3>
            <p className={v2 ? 'text-sm text-ink3' : 'text-sm text-gray-500'}>This will stop all syncing immediately.</p>
          </div>
        </div>
        <p className={v2 ? 'text-sm text-ink2' : 'text-sm text-gray-700'}>
          Are you sure you want to disconnect Opera Cloud? Automatic checkout detection, VIP flags,
          and real-time room sync will stop until you reconnect.
        </p>
        <div className="flex gap-3 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={loading} className="flex-1 justify-center">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading} className="flex-1 justify-center">
            {loading ? (
              <><Loader2 size={14} className="animate-spin" />Disconnecting…</>
            ) : (
              'Disconnect'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('integrations', hotel)

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ count: number; at: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // ── Connect form state ────────────────────────────────────────────────────
  const [form, setForm] = useState<OperaConnectRequest>({
    ohip_base_url: '',
    hotel_id_opera: '',
    integration_username: '',
    integration_password: '',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)

  const setField = (key: keyof OperaConnectRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  // ── Opera status query ────────────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: ['opera-status'],
    queryFn: () => integrationsApi.getOperaStatus(),
    select: (res) => res.data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const operaStatus = statusQuery.data
  const conflictsQuery = useQuery({
    queryKey: ['opera-sync-conflicts'],
    queryFn: () => integrationsApi.listOperaConflicts(),
    select: (res) => res.data,
    enabled: Boolean(operaStatus?.connected),
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const connectMutation = useMutation({
    mutationFn: () => integrationsApi.connectOpera({
      ohip_base_url: form.ohip_base_url,
      hotel_id_opera: form.hotel_id_opera,
      integration_username: form.integration_username || undefined,
      integration_password: form.integration_password || undefined,
    }),
    onSuccess: () => {
      setSuccessBanner('Opera Cloud connected successfully. Syncing reservations now.')
      queryClient.invalidateQueries({ queryKey: ['opera-status'] })
      setForm({ ohip_base_url: '', hotel_id_opera: '', integration_username: '', integration_password: '' })
      setShowAdvanced(false)
    },
    onError: (err: any) => {
      setErrorBanner(err.message || 'Failed to connect Opera Cloud. Check your credentials.')
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => integrationsApi.syncOpera(),
    onSuccess: (res) => {
      setSyncResult({ count: res.data.synced_reservations, at: res.data.synced_at })
      queryClient.invalidateQueries({ queryKey: ['opera-status'] })
    },
    onError: (err: any) => {
      setErrorBanner(err.message || 'Force sync failed. Please try again.')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => integrationsApi.testOpera(),
    onSuccess: (res) => {
      setTestResult({ ok: res.data.connected, message: res.data.message })
    },
    onError: (err: any) => {
      setTestResult({ ok: false, message: err.message || 'Connection test failed.' })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: () => integrationsApi.disconnectOpera(),
    onSuccess: () => {
      setShowDisconnectConfirm(false)
      setSyncResult(null)
      setTestResult(null)
      queryClient.invalidateQueries({ queryKey: ['opera-status'] })
      setSuccessBanner('Opera Cloud disconnected.')
    },
    onError: (err: any) => {
      setShowDisconnectConfirm(false)
      setErrorBanner(err.message || 'Failed to disconnect. Please try again.')
    },
  })

  const resolveConflictMutation = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: 'local_wins' | 'remote_wins' }) =>
      integrationsApi.resolveOperaConflict(id, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opera-sync-conflicts'] })
      setSuccessBanner('Opera conflict resolved and recorded.')
    },
    onError: (err: any) => setErrorBanner(err.message || 'Could not resolve the Opera conflict.'),
  })

  const canConnect = form.ohip_base_url.trim() !== '' && form.hotel_id_opera.trim() !== ''

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title={v2 ? t('integrations.pageTitle') : 'Integrations'}
        subtitle={v2 ? t('integrations.pageSubtitle') : 'Connect external systems to power your hotel operations.'}
        dataI18nSkip={v2}
      />

      {/* Success banner */}
      {successBanner && (
        <div
          role="alert"
          className={
            v2
              ? 'flex items-center gap-3 bg-ready-soft border border-ready-line text-ready rounded-[var(--r-md)] px-4 py-3 text-sm font-medium'
              : 'flex items-center gap-3 bg-[var(--ready-soft)] border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm font-medium'
          }
        >
          <CheckCircle2 size={16} className="text-[var(--ready)] shrink-0" />
          {successBanner}
        </div>
      )}

      {/* Error banner */}
      {errorBanner && (
        <div
          role="alert"
          className={
            v2
              ? 'flex items-center gap-3 bg-alert-soft border border-alert-line text-alert rounded-[var(--r-md)] px-4 py-3 text-sm font-medium'
              : 'flex items-center gap-3 bg-[var(--alert-soft)] border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm font-medium'
          }
        >
          <AlertTriangle size={16} className="text-[var(--alert)] shrink-0" />
          {errorBanner}
        </div>
      )}

      {/* ── Opera Cloud Card ── */}
      <Card className="p-6 space-y-5">
        {/* Card header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center shrink-0">
              <Link2 size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('integrations.opera.title')}</h2>
              {statusQuery.isLoading ? (
                <p className="text-sm text-gray-400 mt-0.5">{t('integrations.opera.loadingStatus')}</p>
              ) : operaStatus?.connected ? (
                <p className="text-sm text-gray-500 mt-0.5">
                  {t('integrations.opera.hotelIdLabel')}{' '}
                  <span className="font-medium text-gray-700">{operaStatus.opera_hotel_id ?? '—'}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-0.5">
                  {t('integrations.opera.disconnectedHint')}
                </p>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
            {statusQuery.isLoading ? (
              <Loader2 size={14} className="animate-spin text-gray-400" />
            ) : operaStatus?.connected ? (
              <><span className="w-2 h-2 rounded-full bg-[var(--ready)]" /><span className="text-green-700 font-medium text-sm">Connected</span></>
            ) : (
              <><span className="w-2 h-2 rounded-full bg-gray-300" /><span className="text-gray-400 font-medium text-sm">Disconnected</span></>
            )}
          </div>
        </div>

        {/* Connected state */}
        {!statusQuery.isLoading && operaStatus?.connected && (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-500 bg-[var(--caution-soft)]/40 border border-amber-100/50 rounded-lg px-4 py-3">
              {operaStatus.last_sync_at && (
                <span>Last synced: <span className="text-gray-700 font-medium">{relativeTime(operaStatus.last_sync_at)}</span></span>
              )}
              {operaStatus.connected_since && (
                <span>Connected since: <span className="text-gray-700 font-medium">{new Date(operaStatus.connected_since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
              )}
              {operaStatus.ohip_base_url && (
                <span className="truncate max-w-xs">Endpoint: <span className="text-gray-700 font-medium font-mono text-xs">{operaStatus.ohip_base_url}</span></span>
              )}
            </div>

            {syncResult && (
              <div
                className={
                  v2
                    ? 'flex items-center gap-2 text-sm text-ready bg-ready-soft border border-ready-line rounded-[var(--r-md)] px-4 py-2.5'
                    : 'flex items-center gap-2 text-sm text-green-700 bg-[var(--ready-soft)] border border-green-200 rounded-lg px-4 py-2.5'
                }
              >
                <CheckCircle2 size={14} className="shrink-0 text-[var(--ready)]" />
                Synced {syncResult.count} reservation{syncResult.count !== 1 ? 's' : ''} — {relativeTime(syncResult.at)}
              </div>
            )}

            {testResult && (
              <div
                className={
                  v2
                    ? `flex items-center gap-2 text-sm rounded-[var(--r-md)] px-4 py-2.5 border ${testResult.ok ? 'text-ready bg-ready-soft border-ready-line' : 'text-alert bg-alert-soft border-alert-line'}`
                    : `flex items-center gap-2 text-sm rounded-lg px-4 py-2.5 border ${testResult.ok ? 'text-green-700 bg-[var(--ready-soft)] border-green-200' : 'text-red-700 bg-[var(--alert-soft)] border-red-200'}`
                }
              >
                {testResult.ok ? <CheckCircle2 size={14} className="shrink-0 text-[var(--ready)]" /> : <XCircle size={14} className="shrink-0 text-[var(--alert)]" />}
                {testResult.message}
              </div>
            )}

            {v2 ? (
              (conflictsQuery.isLoading || conflictsQuery.isError || (conflictsQuery.data?.length ?? 0) > 0) && (
                <div className="rounded-[var(--r-lg)] border border-alert-line bg-alert-soft p-4 space-y-3" aria-live="polite">
                  {conflictsQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton variant="text" className="w-1/2" />
                      <Skeleton variant="text" className="w-full" />
                    </div>
                  ) : conflictsQuery.isError ? (
                    <StateBlock
                      status="error"
                      error={{ message: t('integrations.conflicts.loadError'), onRetry: () => conflictsQuery.refetch() }}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-sm font-semibold text-alert">
                        <AlertTriangle size={16} />
                        {conflictsQuery.data?.length} source-of-truth conflict{conflictsQuery.data?.length === 1 ? '' : 's'} need review
                      </div>
                      {conflictsQuery.data?.map((conflict) => (
                        <div key={conflict.id} className="rounded-[var(--r-md)] bg-surface border border-line p-3 text-sm text-ink2">
                          <p className="font-medium">Opera reservation {conflict.external_id}</p>
                          <p className="mt-1 text-xs text-ink3">
                            PatelRep: {conflict.local_snapshot?.guest_name || 'No guest'} · Opera: {conflict.remote_snapshot?.guest_name || 'No guest'}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button className="text-xs" variant="ghost" disabled={resolveConflictMutation.isPending} onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'local_wins' })}>
                              Keep PatelRep value
                            </Button>
                            <Button className="text-xs" variant="primary" disabled={resolveConflictMutation.isPending} onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'remote_wins' })}>
                              Use Opera value
                            </Button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            ) : (
              (conflictsQuery.data?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-red-200 bg-[var(--alert-soft)] p-4 space-y-3" aria-live="polite">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                    <AlertTriangle size={16} />
                    {conflictsQuery.data?.length} source-of-truth conflict{conflictsQuery.data?.length === 1 ? '' : 's'} need review
                  </div>
                  {conflictsQuery.data?.map((conflict) => (
                    <div key={conflict.id} className="rounded-md bg-surface border border-red-100 p-3 text-sm text-gray-700">
                      <p className="font-medium">Opera reservation {conflict.external_id}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        PatelRep: {conflict.local_snapshot?.guest_name || 'No guest'} · Opera: {conflict.remote_snapshot?.guest_name || 'No guest'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button className="text-xs" variant="ghost" disabled={resolveConflictMutation.isPending} onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'local_wins' })}>
                          Keep PatelRep value
                        </Button>
                        <Button className="text-xs" variant="primary" disabled={resolveConflictMutation.isPending} onClick={() => resolveConflictMutation.mutate({ id: conflict.id, resolution: 'remote_wins' })}>
                          Use Opera value
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="ghost" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || syncMutation.isPending}>
                {testMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Test Connection
              </Button>
              <Button variant="ghost" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || testMutation.isPending}>
                {syncMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Force Sync
              </Button>
              <Button variant="destructive" onClick={() => setShowDisconnectConfirm(true)} disabled={disconnectMutation.isPending} className="ml-auto">
                <Trash2 size={14} />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {/* Disconnected state — feature list + credential form */}
        {/* Suppressed on statusQuery.isError (e.g. a 403 from the D-03 pilot gate for a
            non-pilot hotel) so a GM is never shown an interactive Connect form that the
            backend will unconditionally reject -- the "Status fetch error" block below
            is the single source of truth for that case instead. */}
        {!statusQuery.isLoading && !statusQuery.isError && !operaStatus?.connected && (
          <>
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-gray-700">What you get when connected:</p>
              <ul className="space-y-2">
                {[
                  'Automatic checkout → room marked Vacant Dirty',
                  'Guest VIP flags + check-in times synced',
                  'Bidirectional room status sync',
                  'Real-time Business Events webhooks',
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5 text-sm text-gray-600">
                    <Check size={14} className="text-green-500 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-4">
              <p className="text-sm font-medium text-gray-700">Enter your OHIP credentials to connect:</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor="opera-ohip-base-url" required>OHIP Base URL</FieldLabel>
                  <CredentialInput
                    v2={v2}
                    id="opera-ohip-base-url"
                    type="url"
                    placeholder="https://hospitality.oracle.com"
                    value={form.ohip_base_url}
                    onChange={setField('ohip_base_url')}
                    disabled={connectMutation.isPending}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="opera-hotel-code" required>Opera Hotel Code</FieldLabel>
                  <CredentialInput
                    v2={v2}
                    id="opera-hotel-code"
                    type="text"
                    placeholder="SAND01"
                    value={form.hotel_id_opera}
                    onChange={setField('hotel_id_opera')}
                    disabled={connectMutation.isPending}
                  />
                </div>
              </div>

              {/* Advanced: integration user credentials for password grant */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  aria-expanded={showAdvanced}
                  aria-controls="opera-advanced-credentials"
                  className={
                    v2
                      ? 'flex items-center gap-1.5 text-xs font-medium text-ink3 hover:text-ink2 transition-colors duration-fast ease-standard rounded-[var(--r-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'
                      : 'flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors'
                  }
                >
                  {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  Integration user credentials (optional — for password grant)
                </button>

                {showAdvanced && (
                  <div id="opera-advanced-credentials" className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <FieldLabel htmlFor="opera-integration-username">Username</FieldLabel>
                      <CredentialInput
                        v2={v2}
                        id="opera-integration-username"
                        type="text"
                        placeholder="integration_user"
                        value={form.integration_username}
                        onChange={setField('integration_username')}
                        disabled={connectMutation.isPending}
                        autoComplete="username"
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor="opera-integration-password">Password</FieldLabel>
                      <CredentialInput
                        v2={v2}
                        id="opera-integration-password"
                        type="password"
                        placeholder="••••••••"
                        value={form.integration_password}
                        onChange={setField('integration_password')}
                        disabled={connectMutation.isPending}
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  variant="primary"
                  onClick={() => connectMutation.mutate()}
                  disabled={!canConnect || connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <><Loader2 size={14} className="animate-spin" />Connecting…</>
                  ) : (
                    <>Connect Opera Cloud<ArrowRight size={14} /></>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Skeleton while loading */}
        {statusQuery.isLoading && (
          v2 ? (
            <div className="space-y-3">
              <Skeleton variant="text" className="w-3/4" />
              <Skeleton variant="text" className="w-1/2" />
              <Skeleton variant="text" className="w-2/3" />
            </div>
          ) : (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="h-4 bg-gray-100 rounded w-2/3" />
            </div>
          )
        )}

        {/* Status fetch error */}
        {statusQuery.isError && (
          v2 ? (
            <StateBlock
              status="error"
              error={{ message: t('integrations.loadError'), onRetry: () => statusQuery.refetch() }}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-[var(--alert)]">
              <AlertTriangle size={14} className="shrink-0" />
              {(statusQuery.error as any)?.message || 'Failed to load Opera status.'}{' '}
              <button onClick={() => statusQuery.refetch()} className="underline hover:no-underline">
                Retry
              </button>
            </div>
          )
        )}
      </Card>

      {/* ── SOP Library Card ── */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--caution)] flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('integrations.sopLibrary.title')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{t('integrations.sopLibrary.subtitle')}</p>
            </div>
          </div>
          <Link
            href="/sop"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--caution-soft)] border border-[var(--caution-line)] text-[var(--caution)] hover:bg-amber-100 rounded-lg transition-colors shrink-0"
          >
            {t('integrations.sopLibrary.manageLink')}
            <ArrowRight size={14} />
          </Link>
        </div>
      </Card>

      {/* Disconnect confirm dialog */}
      {showDisconnectConfirm && (
        <ConfirmDisconnectDialog
          v2={v2}
          loading={disconnectMutation.isPending}
          onCancel={() => setShowDisconnectConfirm(false)}
          onConfirm={() => disconnectMutation.mutate()}
        />
      )}
    </div>
  )
}
