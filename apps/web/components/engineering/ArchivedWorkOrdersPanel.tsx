'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Loader2 } from 'lucide-react'
import { engineeringApi } from '@/lib/api/engineering'
import { ApiClientError } from '@/lib/api/client'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { EmptyState } from '@/components/ui/EmptyState'

export function ArchivedWorkOrdersPanel({ redesigned = false }: { redesigned?: boolean }) {
  const { t } = useTranslation()
  const { role } = useRole()
  const canManage = role === 'engineer' || role === 'gm'
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['work-orders', 'archived'],
    queryFn: () => engineeringApi.listWorkOrders({ archived: true, per_page: 100 }),
  })

  const restoreMutation = useMutation({
    mutationFn: (workOrderId: string) =>
      engineeringApi.bulkUnarchiveWorkOrders({ work_order_ids: [workOrderId] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      setMessage({ text: t('engineering.workOrdersPage.archivedPanelRestoreSuccess'), isError: false })
    },
    onError: (err) => {
      setMessage({
        text: t('engineering.workOrdersPage.archivedPanelRestoreError', {
          error: err instanceof ApiClientError ? err.message : String(err),
        }),
        isError: true,
      })
    },
  })

  const workOrders = data?.data ?? []

  if (isLoading) {
    if (redesigned) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="card" className="h-16" />
          ))}
        </div>
      )
    }
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-surface-3 rounded-[var(--r-lg)] animate-pulse border border-line" />
        ))}
      </div>
    )
  }

  if (redesigned && isError) {
    return (
      <StateBlock
        status="error"
        error={{ message: t('engineering.workOrderList.loadError'), onRetry: () => refetch() }}
      />
    )
  }

  if (workOrders.length === 0) {
    if (redesigned) {
      return (
        <EmptyState
          icon={<ClipboardList className="w-10 h-10" />}
          title={t('engineering.workOrdersPage.archivedPanelEmpty')}
        />
      )
    }
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ClipboardList className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">{t('engineering.workOrdersPage.archivedPanelEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {message && (
        <p
          className={
            message.isError
              ? 'text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2'
              : 'text-sm text-[var(--ready)] bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg px-3 py-2'
          }
        >
          {message.text}
        </p>
      )}
      {workOrders.map((wo) => (
        <div
          key={wo.id}
          className="flex items-center justify-between gap-3 bg-surface border border-line rounded-[var(--r-lg)] px-4 py-3"
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-ink3 mb-0.5">WO-{wo.work_order_number}</p>
            <p className="text-sm font-medium text-ink truncate">{wo.title}</p>
            <p className="text-xs text-ink3">{wo.status}</p>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => restoreMutation.mutate(wo.id)}
              disabled={restoreMutation.isPending}
              className="shrink-0"
            >
              {restoreMutation.isPending && restoreMutation.variables === wo.id && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              {t('engineering.workOrdersPage.archivedPanelRestore')}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
