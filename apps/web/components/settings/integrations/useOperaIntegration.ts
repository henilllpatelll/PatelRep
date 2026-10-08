'use client'

import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, type OperaConflictResolution, type OperaStatus } from '@/lib/api/integrations'
import { errorMessage, errorStatus } from '@/lib/settings/apiErrors'
import { buildConnectPayload, isSftpMode, sessionResult, type ConnectFormValues, type SessionResult } from '@/lib/settings/integrations'
import { useHotelStore } from '@/stores/hotelStore'
import { useToast } from '@/components/ui/Toast'

/**
 * One source of truth for the OPERA connection: server status + conflicts, and every action.
 *
 * - Actions share a single `busy` flag so Test / Sync / Disconnect can never overlap or be double-submitted.
 * - After every mutation the authoritative status and conflict list are refetched; nothing is shown as
 *   connected or resolved until the server says so.
 * - Test and sync outcomes are only known for this browser session (the API doesn't store them), so they
 *   are kept in local state and labelled that way in the UI.
 * - No credential value ever enters this hook's state or logs: the connect payload is passed straight through.
 */
export function useOperaIntegration() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const hotelId = useHotelStore((s) => s.hotel?.id)

  const [lastTest, setLastTest] = useState<SessionResult | null>(null)
  const [lastSync, setLastSync] = useState<SessionResult | null>(null)

  const statusQuery = useQuery({
    queryKey: ['opera-status', hotelId],
    queryFn: () => integrationsApi.getOperaStatus(),
    select: (res): OperaStatus => res.data,
    enabled: !!hotelId,
    staleTime: 30_000,
    // 403 (not enrolled) and 503 (disabled here) never fix themselves — don't hammer them.
    retry: (count, err) => (errorStatus(err) === 403 || errorStatus(err) === 503 ? false : count < 1),
  })
  const status = statusQuery.data
  const connected = Boolean(status?.connected)

  const conflictsQuery = useQuery({
    queryKey: ['opera-sync-conflicts', hotelId],
    queryFn: () => integrationsApi.listOperaConflicts(),
    select: (res) => res.data ?? [],
    enabled: !!hotelId && connected,
  })

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['opera-status'] }),
      queryClient.invalidateQueries({ queryKey: ['opera-sync-conflicts'] }),
    ])
  }, [queryClient])

  const connect = useMutation({
    mutationFn: (values: ConnectFormValues) => integrationsApi.connectOpera(buildConnectPayload(values)),
    onSuccess: async () => {
      setLastTest(null)
      setLastSync(null)
      await refresh()
      toast.success('Connection saved. OPERA Cloud accepted the credentials.')
    },
  })

  const test = useMutation({
    mutationFn: () => (isSftpMode(status) ? integrationsApi.testOperaSftp() : integrationsApi.testOpera()),
    onSuccess: (res) => setLastTest(sessionResult(Boolean(res.data.connected), res.data.message || 'Connection verified.')),
    onError: (err) => setLastTest(sessionResult(false, errorMessage(err, 'The connection test failed.'))),
  })

  const sync = useMutation({
    mutationFn: async () => {
      if (isSftpMode(status)) {
        const res = await integrationsApi.syncOperaSftp()
        const { files_processed: files, synced_rows: rows } = res.data
        return `${files} report file${files === 1 ? '' : 's'} processed, ${rows} row${rows === 1 ? '' : 's'} synced.`
      }
      const res = await integrationsApi.syncOpera()
      const n = res.data.synced_reservations
      return `${n} reservation${n === 1 ? '' : 's'} processed.`
    },
    onSuccess: async (message) => {
      setLastSync(sessionResult(true, message))
      await refresh()
    },
    onError: async (err) => {
      setLastSync(sessionResult(false, errorMessage(err, 'The sync failed.')))
      await refresh()
    },
  })

  const disconnect = useMutation({
    mutationFn: () => integrationsApi.disconnectOpera(),
    onSuccess: async () => {
      setLastTest(null)
      setLastSync(null)
      await refresh()
      toast.success('Oracle OPERA Cloud disconnected.')
    },
  })

  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: OperaConflictResolution }) =>
      integrationsApi.resolveOperaConflict(id, resolution),
    // Refetch even on failure: a 404 means someone else already resolved it, and the list must reflect that.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['opera-sync-conflicts'] }),
  })

  /** True while any connection-affecting request is in flight; every action button keys off this. */
  const busy = connect.isPending || test.isPending || sync.isPending || disconnect.isPending

  // React Query publishes `isPending` a tick after `mutate()`, so two very fast clicks could both start a
  // request. This lock is taken synchronously and makes the actions strictly one-at-a-time.
  const lock = useRef(false)
  const exclusive = useCallback(async <T,>(run: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> => {
    if (lock.current) return { ran: false }
    lock.current = true
    try {
      return { ran: true, value: await run() }
    } finally {
      lock.current = false
    }
  }, [])
  const runTest = useCallback(() => { void exclusive(() => test.mutateAsync().catch(() => undefined)) }, [exclusive, test])
  const runSync = useCallback(() => { void exclusive(() => sync.mutateAsync().catch(() => undefined)) }, [exclusive, sync])
  /** Throws on failure (callers show the message); resolves false when another action was already running. */
  const connectNow = useCallback(async (values: ConnectFormValues) => (await exclusive(() => connect.mutateAsync(values))).ran, [exclusive, connect])
  const disconnectNow = useCallback(async () => (await exclusive(() => disconnect.mutateAsync())).ran, [exclusive, disconnect])

  return {
    statusQuery, status, connected, conflictsQuery,
    conflicts: conflictsQuery.data ?? [],
    connect, test, sync, disconnect, resolve, busy,
    runTest, runSync, connectNow, disconnectNow,
    lastTest, lastSync,
  }
}

export type OperaIntegration = ReturnType<typeof useOperaIntegration>
