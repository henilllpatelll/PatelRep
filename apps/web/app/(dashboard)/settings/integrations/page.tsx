'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
} from 'lucide-react'
import { integrationsApi } from '@/lib/api/integrations'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  return 'just now'
}

// ─── Disconnect Confirm Dialog ────────────────────────────────────────────────

function ConfirmDisconnectDialog({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-indigo-950/20 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div className="relative bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Disconnect Opera Cloud</h3>
            <p className="text-sm text-gray-500">This will stop all syncing immediately.</p>
          </div>
        </div>

        <p className="text-sm text-gray-700">
          Are you sure you want to disconnect Opera Cloud? Automatic checkout detection, VIP flags,
          and real-time room sync will stop until you reconnect.
        </p>

        <div className="flex gap-3 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={loading} className="flex-1 justify-center">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading} className="flex-1 justify-center">
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Disconnecting…
              </>
            ) : (
              'Disconnect'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Inner page (uses useSearchParams) ────────────────────────────────────────

function IntegrationsPageInner() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ count: number; at: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // ── Handle redirect back from Opera OAuth ─────────────────────────────────

  useEffect(() => {
    const status = searchParams.get('opera')
    if (status === 'connected') {
      setSuccessBanner('Opera Cloud connected successfully. Syncing reservations now.')
      // Clean URL without full reload
      const url = new URL(window.location.href)
      url.searchParams.delete('opera')
      window.history.replaceState({}, '', url.toString())
    } else if (status === 'error') {
      const msg = searchParams.get('message') || 'Failed to connect Opera Cloud. Please try again.'
      setErrorBanner(msg)
      const url = new URL(window.location.href)
      url.searchParams.delete('opera')
      url.searchParams.delete('message')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  // ── Auto-dismiss banners after 5 seconds ──────────────────────────────────

  useEffect(() => {
    if (!successBanner) return
    const t = setTimeout(() => setSuccessBanner(null), 5000)
    return () => clearTimeout(t)
  }, [successBanner])

  useEffect(() => {
    if (!errorBanner) return
    const t = setTimeout(() => setErrorBanner(null), 5000)
    return () => clearTimeout(t)
  }, [errorBanner])

  // ── Auto-dismiss test result after 5 seconds ──────────────────────────────

  useEffect(() => {
    if (!testResult) return
    const t = setTimeout(() => setTestResult(null), 5000)
    return () => clearTimeout(t)
  }, [testResult])

  // ── Opera status query ─────────────────────────────────────────────────────

  const statusQuery = useQuery({
    queryKey: ['opera-status'],
    queryFn: () => integrationsApi.getOperaStatus(),
    select: (res) => res.data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const operaStatus = statusQuery.data

  // ── Mutations ─────────────────────────────────────────────────────────────

  const connectMutation = useMutation({
    mutationFn: () => integrationsApi.connectOpera(),
    onSuccess: (res) => {
      window.location.href = res.data.auth_url
    },
    onError: (err: any) => {
      setErrorBanner(err.message || 'Failed to initiate Opera Cloud connection.')
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Connect external systems to power your hotel operations.</p>
      </div>

      {/* Success banner */}
      {successBanner && (
        <div
          role="alert"
          className="flex items-center gap-3 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm font-medium"
        >
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          {successBanner}
        </div>
      )}

      {/* Error banner */}
      {errorBanner && (
        <div
          role="alert"
          className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm font-medium"
        >
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
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
              <h2 className="text-base font-semibold text-gray-900">Opera Cloud (OHIP)</h2>
              {statusQuery.isLoading ? (
                <p className="text-sm text-gray-400 mt-0.5">Loading status…</p>
              ) : operaStatus?.connected ? (
                <p className="text-sm text-gray-500 mt-0.5">
                  Hotel ID:{' '}
                  <span className="font-medium text-gray-700">{operaStatus.opera_hotel_id ?? '—'}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-0.5">
                  Sync reservations, room status, and guest profiles in real-time
                </p>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
            {statusQuery.isLoading ? (
              <Loader2 size={14} className="animate-spin text-gray-400" />
            ) : operaStatus?.connected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-green-700 font-medium text-sm">Connected</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                <span className="text-gray-400 font-medium text-sm">Disconnected</span>
              </>
            )}
          </div>
        </div>

        {/* Connected state — metadata + actions */}
        {!statusQuery.isLoading && operaStatus?.connected && (
          <>
            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-500 bg-indigo-50/40 border border-indigo-100/50 rounded-lg px-4 py-3">
              {operaStatus.last_sync_at && (
                <span>
                  Last synced:{' '}
                  <span className="text-gray-700 font-medium">
                    {relativeTime(operaStatus.last_sync_at)}
                  </span>
                </span>
              )}
              {operaStatus.connected_since && (
                <span>
                  Connected since:{' '}
                  <span className="text-gray-700 font-medium">
                    {new Date(operaStatus.connected_since).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </span>
              )}
              {operaStatus.ohip_base_url && (
                <span className="truncate max-w-xs">
                  Endpoint:{' '}
                  <span className="text-gray-700 font-medium font-mono text-xs">
                    {operaStatus.ohip_base_url}
                  </span>
                </span>
              )}
            </div>

            {/* Sync result */}
            {syncResult && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                <CheckCircle2 size={14} className="shrink-0 text-green-600" />
                Synced {syncResult.count} reservation{syncResult.count !== 1 ? 's' : ''} —{' '}
                {relativeTime(syncResult.at)}
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div
                className={`flex items-center gap-2 text-sm rounded-lg px-4 py-2.5 border ${
                  testResult.ok
                    ? 'text-green-700 bg-green-50 border-green-200'
                    : 'text-red-700 bg-red-50 border-red-200'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 size={14} className="shrink-0 text-green-600" />
                ) : (
                  <XCircle size={14} className="shrink-0 text-red-500" />
                )}
                {testResult.message}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant="ghost"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || syncMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Zap size={14} />
                )}
                Test Connection
              </Button>

              <Button
                variant="ghost"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || testMutation.isPending}
              >
                {syncMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Force Sync
              </Button>

              <Button
                variant="destructive"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={disconnectMutation.isPending}
                className="ml-auto"
              >
                <Trash2 size={14} />
                Disconnect
              </Button>
            </div>
          </>
        )}

        {/* Disconnected state — feature list + connect button */}
        {!statusQuery.isLoading && !operaStatus?.connected && (
          <>
            <div className="space-y-2.5">
              <p className="text-sm font-medium text-gray-700">What you get when connected:</p>
              <ul className="space-y-2">
                {[
                  'Automatic checkout → room marked Dirty',
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

            <div className="flex justify-end pt-1">
              <Button
                variant="primary"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    Connect Opera Cloud
                    <ArrowRight size={14} />
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Skeleton while loading */}
        {statusQuery.isLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="h-4 bg-gray-100 rounded w-2/3" />
          </div>
        )}

        {/* Status fetch error */}
        {statusQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle size={14} className="shrink-0" />
            Failed to load Opera status.{' '}
            <button
              onClick={() => statusQuery.refetch()}
              className="underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}
      </Card>

      {/* ── SOP Library Card ── */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
              <BookOpen size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">SOP Library</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Upload PDF documents to power the AI Copilot Q&amp;A
              </p>
            </div>
          </div>
          <Link
            href="/sop"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors shrink-0"
          >
            Manage SOP Library
            <ArrowRight size={14} />
          </Link>
        </div>
      </Card>

      {/* Disconnect confirm dialog */}
      {showDisconnectConfirm && (
        <ConfirmDisconnectDialog
          loading={disconnectMutation.isPending}
          onCancel={() => setShowDisconnectConfirm(false)}
          onConfirm={() => disconnectMutation.mutate()}
        />
      )}
    </div>
  )
}

// ─── Page export (wraps inner in Suspense for useSearchParams) ────────────────

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-6">Loading…</div>}>
      <IntegrationsPageInner />
    </Suspense>
  )
}
