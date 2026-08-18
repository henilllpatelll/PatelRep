'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { AlertCircle, CheckCircle2, Clock3, MessageSquareWarning } from 'lucide-react'
import { feedbackApi, type FeedbackSubmission } from '@/lib/api/feedback'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  confusing: 'Confusing',
  missing_feature: 'Missing',
  too_slow: 'Slow',
  other: 'Other',
}

const SEVERITY_TONE: Record<string, 'high' | 'medium' | 'low'> = {
  blocking: 'high',
  annoying: 'medium',
  idea: 'low',
}

function notificationCopy(status: FeedbackSubmission['notification_status']) {
  if (status === 'sent') return { icon: CheckCircle2, label: 'Alert sent', className: 'text-ready' }
  if (status === 'failed') return { icon: AlertCircle, label: 'Alert failed', className: 'text-alert' }
  if (status === 'not_configured') return { icon: Clock3, label: 'Webhook off', className: 'text-ink3' }
  return { icon: Clock3, label: 'Pending', className: 'text-ink3' }
}

function FeedbackRow({ item }: { item: FeedbackSubmission }) {
  const notification = notificationCopy(item.notification_status)
  const NotificationIcon = notification.icon
  const createdAgo = item.created_at
    ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true })
    : 'just now'

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_TONE[item.severity] ?? 'secondary'}>
              {item.severity}
            </Badge>
            <Badge variant="default">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
            <span className="text-[12px] text-ink3">{createdAgo}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{item.message}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-ink3">
            {item.pathname && <span className="font-mono">{item.pathname}</span>}
            {item.user_role && <span>{item.user_role.replaceAll('_', ' ')}</span>}
            {item.viewport_width && item.viewport_height && (
              <span>{item.viewport_width}x{item.viewport_height}</span>
            )}
          </div>
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 text-[12px] ${notification.className}`}>
          <NotificationIcon size={14} />
          {notification.label}
        </div>
      </div>
    </Card>
  )
}

export default function FeedbackSettingsPage() {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('guestFeedback', hotel)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['feedback-submissions'],
    queryFn: () => feedbackApi.list(),
  })

  const feedback = data?.data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-display font-normal text-ink">Feedback</h2>
        <p className="mt-1 text-sm text-ink3">Staff reports from the floating feedback button.</p>
      </div>

      <StateBlock
        status={isLoading ? 'loading' : isError ? 'error' : feedback.length === 0 ? 'empty' : null}
        loadingLabel="Loading feedback…"
        error={v2 ? { message: t('guestFeedback.loadError'), onRetry: () => refetch() } : { message: 'Feedback could not load.' }}
        empty={{
          icon: <MessageSquareWarning size={20} />,
          title: v2 ? t('guestFeedback.empty.title') : 'No feedback yet',
          body: v2 ? t('guestFeedback.empty.body') : 'New staff reports will appear here.',
        }}
      >
        <div className="space-y-3">
          {feedback.map((item) => (
            <FeedbackRow key={item.id} item={item} />
          ))}
        </div>
      </StateBlock>
    </div>
  )
}
