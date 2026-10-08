'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelsApi } from '@/lib/api/hotels'
import {
  FEEDBACK_INBOX_HREF, HOME_SECTIONS, getDestination, getSettingsHref, type SettingsDestination,
} from '@/lib/settings/navigation'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SETTINGS_ICONS } from '@/components/settings/workspace/settingsIcons'
import { Skeleton } from '@/components/ui/Skeleton'

function PropertyOverview() {
  const hotel = useHotelStore((s) => s.hotel)
  // Same query key as Property Profile, so the two share one cached fetch.
  const { data: full, isLoading } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
  })

  const name = full?.name ?? hotel?.name
  const roomCount = full?.room_count ?? hotel?.room_count
  const timezone = full?.timezone ?? hotel?.timezone
  const place = [full?.city, full?.state].filter(Boolean).join(', ')

  const facts: Array<{ label: string; value: string }> = []
  if (roomCount != null) facts.push({ label: 'Rooms', value: String(roomCount) })
  if (place) facts.push({ label: 'Location', value: place })
  if (timezone) facts.push({ label: 'Timezone', value: timezone.replace(/_/g, ' ') })
  if (full?.phone) facts.push({ label: 'Phone', value: full.phone })

  return (
    <SettingsCard aria-labelledby="settings-property-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Property</p>
          {name ? (
            <h2 id="settings-property-title" className="mt-0.5 truncate text-xl font-semibold text-ink">{name}</h2>
          ) : isLoading ? (
            <Skeleton className="mt-1 h-7 w-56" />
          ) : (
            <h2 id="settings-property-title" className="mt-0.5 text-xl font-semibold text-ink">Your property</h2>
          )}
        </div>
        <Link
          href="/settings/general"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:min-h-[32px]"
        >
          Edit profile <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-ink-3">{fact.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SettingsCard>
  )
}

function DestinationTile({ destination, meta }: { destination: SettingsDestination; meta?: string }) {
  const Icon = SETTINGS_ICONS[destination.icon]
  const href = getSettingsHref(destination)
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--accent-soft)] text-[var(--accent)]" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{destination.label}</span>
          {meta && <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-2">{meta}</span>}
          {!href && <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">Soon</span>}
        </span>
        <span className="mt-0.5 block text-[13px] leading-5 text-ink-3">{destination.description}</span>
      </span>
      {href && <ArrowRight size={16} className="mt-1 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />}
    </>
  )

  const shared = 'flex min-h-[72px] items-start gap-3 rounded-[var(--r-lg)] border border-line bg-surface p-4'
  if (!href) {
    return <li><div aria-disabled="true" className={`${shared} opacity-70`}>{body}</div></li>
  }
  return (
    <li>
      <Link
        href={href}
        className={`${shared} group shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`}
      >
        {body}
      </Link>
    </li>
  )
}

export default function SettingsHomePage() {
  const roomCount = useHotelStore((s) => s.hotel?.room_count)

  return (
    <div className="space-y-6">
      <PropertyOverview />
      {HOME_SECTIONS.map((section) => (
        <section key={section.id} className="space-y-3">
          <SettingsSectionHeader level={2} title={section.label} className="[&_h2]:text-base" />
          <ul className="grid gap-3 sm:grid-cols-2">
            {section.destinationIds.map((id) => {
              const destination = getDestination(id)
              if (!destination) return null
              // Only real data: the room count is already loaded with the hotel.
              const meta = id === 'rooms' && roomCount != null ? `${roomCount} rooms` : undefined
              return <DestinationTile key={id} destination={destination} meta={meta} />
            })}
          </ul>
        </section>
      ))}
      {/* The feedback inbox is a support queue, not property configuration, so it stays out of the nav. */}
      <p className="text-sm text-ink-3">
        Looking for problems and ideas submitted by staff?{' '}
        <Link
          href={FEEDBACK_INBOX_HREF}
          className="font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          Open the staff feedback inbox
        </Link>
      </p>
    </div>
  )
}
