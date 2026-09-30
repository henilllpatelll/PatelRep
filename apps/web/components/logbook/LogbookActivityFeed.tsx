'use client'

import { BookOpen, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LogbookEntry } from '@/lib/api/logbook'
import { Button } from '@/components/ui/Button'
import { SectionLabel } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { LogbookActivityRow } from './LogbookActivityRow'

interface LogbookActivityFeedProps {
  entries: LogbookEntry[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  isToday: boolean
  canCreate: boolean
  currentUserId: string
  canManageAny: boolean
  onCreate: () => void
  onSearch?: () => void
  onOpen: (entry: LogbookEntry) => void
  onEdit: (entry: LogbookEntry) => void
  onDelete: (entry: LogbookEntry) => void
}

function ActivitySkeleton() {
  return <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="grid gap-3 md:grid-cols-[82px_minmax(0,1fr)]"><Skeleton className="mt-4 h-3 w-14" /><div className="rounded-[var(--r-lg)] border border-line bg-surface p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-4 w-full" /><Skeleton className="mt-2 h-4 w-4/5" /><Skeleton className="mt-4 h-3 w-32" /></div></div>)}</div>
}

export function LogbookActivityFeed(props: LogbookActivityFeedProps) {
  const { t } = useTranslation()
  const { entries, isLoading, isError, onRetry, hasMore, isLoadingMore, onLoadMore, isToday, canCreate, currentUserId, canManageAny, onCreate, onSearch, onOpen, onEdit, onDelete } = props

  return (
    <section aria-labelledby="logbook-activity-heading">
      <SectionLabel hint={entries.length ? t('logbook.entryCount', { count: entries.length }) : undefined}>
        <h2 id="logbook-activity-heading">{t('logbook.activity')}</h2>
      </SectionLabel>
      {isLoading ? <ActivitySkeleton /> : (
        <StateBlock
          status={isError ? 'error' : entries.length === 0 ? 'empty' : null}
          error={{ message: t('logbook.loadError'), onRetry }}
          empty={{
            icon: <BookOpen className="size-6" aria-hidden="true" />,
            title: isToday ? t('logbook.noHandoffs') : t('logbook.noEntriesForShift'),
            body: isToday ? `${t('logbook.noHandoffsBody')} ${t('logbook.emptyExamples')}` : undefined,
            action: isToday && canCreate ? <Button variant="primary" size="sm" onClick={onCreate}><Plus className="size-4" />{t('logbook.addFirstHandoff')}</Button> : !isToday && onSearch ? <Button variant="outline" size="sm" onClick={onSearch}>{t('logbook.searchLogbook')}</Button> : undefined,
          }}
        >
          <div>
            {entries.map((entry) => <LogbookActivityRow key={entry.id} entry={entry} canEdit={canManageAny || entry.author_id === currentUserId} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />)}
            {hasMore && <div className="pt-5 text-center"><Button variant="outline" size="sm" onClick={onLoadMore} loading={isLoadingMore}>{isLoadingMore ? t('logbook.loadingEarlier') : t('logbook.loadEarlier')}</Button></div>}
          </div>
        </StateBlock>
      )}
    </section>
  )
}
