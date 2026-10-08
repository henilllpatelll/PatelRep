'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { activityApi } from '@/lib/api/activity'
import { errorStatus } from '@/lib/settings/apiErrors'
import { describeChange, formatFullTimestamp, sourceLabel, type ChangeView } from '@/lib/settings/activity'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      <div className="text-sm text-ink">{children}</div>
    </section>
  )
}

const NOT_RECORDED = <span className="text-ink-3">Not recorded</span>

function Chips({ items, tone }: { items: string[]; tone?: 'added' | 'removed' }) {
  if (items.length === 0) return <span className="text-ink-3">None</span>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={
            tone === 'added' ? 'rounded-full border border-[var(--ready-line)] bg-[var(--ready-soft)] px-2 py-0.5 text-xs font-medium text-[var(--ready)]'
              : tone === 'removed' ? 'rounded-full border border-[var(--alert-line)] bg-[var(--alert-soft)] px-2 py-0.5 text-xs font-medium text-[var(--alert)]'
              : 'rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs text-ink-2'
          }
        >
          {tone === 'added' ? '+ ' : tone === 'removed' ? '− ' : ''}{item}
        </li>
      ))}
    </ul>
  )
}

function ChangeBlock({ view }: { view: ChangeView }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line p-3">
      <p className="text-[13px] font-semibold text-ink">{view.label}</p>
      {view.kind === 'value' && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-3">Before</dt><dd>{view.before ?? NOT_RECORDED}</dd>
          <dt className="text-ink-3">After</dt><dd className="font-medium">{view.after ?? NOT_RECORDED}</dd>
        </dl>
      )}
      {view.kind === 'list' && (
        <div className="mt-2 space-y-2">
          <div><p className="mb-1 text-xs text-ink-3">Before</p>{view.before ? <Chips items={view.before} /> : NOT_RECORDED}</div>
          <div><p className="mb-1 text-xs text-ink-3">After</p>{view.after ? <Chips items={view.after} /> : NOT_RECORDED}</div>
          {view.added.length > 0 && <div><p className="mb-1 text-xs text-ink-3">Added</p><Chips items={view.added} tone="added" /></div>}
          {view.removed.length > 0 && <div><p className="mb-1 text-xs text-ink-3">Removed</p><Chips items={view.removed} tone="removed" /></div>}
        </div>
      )}
      {view.kind === 'map' && (
        <ul className="mt-2 space-y-1 text-sm">
          {view.rows.map((row) => (
            <li key={row.key}>
              <span className="text-ink-2">{row.key}:</span>{' '}
              {row.before ?? 'not recorded'} <span aria-label="changed to">→</span> <span className="font-medium">{row.after ?? 'not recorded'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Read-only detail for one recorded event. The server returns only allow-listed, redacted data; this drawer
 * has no actions beyond closing, and states plainly when an event carries no change summary.
 */
export function ActivityDetailsDrawer({ eventId, hotelId, zone, onClose }: { eventId: string; hotelId?: string; zone: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['settings-activity-event', hotelId, eventId],
    queryFn: () => activityApi.get(eventId),
    enabled: !!hotelId,
    staleTime: 60_000,
    retry: (count, err) => errorStatus(err) !== 404 && count < 1,
  })
  const event = query.data?.data
  const tz = query.data?.meta.timezone ?? zone
  const gone = query.isError && errorStatus(query.error) === 404

  return (
    <SettingsDrawer
      title="Activity Details"
      description={event?.title}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex justify-end px-4 py-3 sm:px-5"><Button variant="ghost" onClick={requestClose}>Close</Button></div>
      )}
    >
      {query.isPending ? (
        <SettingsLoading label="Loading activity details…" />
      ) : gone ? (
        <p role="alert" className="text-sm text-ink-2">This activity event is no longer available.</p>
      ) : query.isError || !event ? (
        <SettingsError message="Activity details could not be loaded." onRetry={() => query.refetch()} />
      ) : (
        <div className="space-y-4">
          <Section title="Event">
            <p className="font-medium">{event.title}</p>
            {event.category_label && <p className="text-[13px] text-ink-3">{event.category_label}</p>}
          </Section>
          <Section title="Actor">
            <p>{event.actor.name}</p>
            <p className="text-[13px] text-ink-3">
              {event.actor.role_label ? `${event.actor.role_label} (role at the time)` : 'Role at the time was not recorded'}
            </p>
          </Section>
          <Section title="Date & time">
            <time dateTime={event.occurred_at}>{formatFullTimestamp(event.occurred_at, tz)}</time>
          </Section>
          <Section title="Resource">
            <p>{event.resource.type_label}{event.resource.name ? ` · ${event.resource.name}` : ''}</p>
            <p className="break-all font-mono text-xs text-ink-3">{event.resource.id}</p>
          </Section>
          <Section title="Changes">
            {event.changes && event.changes.length > 0 ? (
              <div className="space-y-2">{event.changes.map((c) => <ChangeBlock key={c.field} view={describeChange(c)} />)}</div>
            ) : (
              <p className="text-ink-3">This event does not include a detailed change summary.</p>
            )}
          </Section>
          {sourceLabel(event.source) && <Section title="Source"><p>{sourceLabel(event.source)}</p></Section>}
          <Section title="Event ID">
            <p className="break-all font-mono text-xs select-all">{event.id}</p>
          </Section>
        </div>
      )}
    </SettingsDrawer>
  )
}
