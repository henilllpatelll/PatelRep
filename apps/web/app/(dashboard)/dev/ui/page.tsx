'use client'

/**
 * TEMPORARY Wave 0 scratch page — demonstrates every new/upgraded shared
 * component from .planning/UI-REFRESH-PLAN.md §4. Not linked from any nav.
 * Remove before Wave 6 per the plan's Wave 0 acceptance gate.
 */

import { AlertCircle, Bed, CheckCircle2, Inbox, Search } from 'lucide-react'
import { useState } from 'react'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { SectionLabel } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { Breadcrumbs } from '@/components/shared/Breadcrumbs'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { MobileFloorNav } from '@/components/shared/MobileFloorNav'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'

export default function DevUIPage() {
  const toast = useToast()
  const [stateDemo, setStateDemo] = useState<'loading' | 'empty' | 'error' | null>(null)

  return (
    <div className="space-y-8 pb-16">
      <PageHeader
        eyebrow="Wave 0 — Foundation"
        title="Component Library"
        subtitle="Scratch page for manually verifying every new shared component in light/dark and all three densities. Delete before Wave 6."
      />

      <Card className="p-5 space-y-3">
        <SectionLabel>DashboardGreeting</SectionLabel>
        <DashboardGreeting name="Alex" hotelName="Lone Star Inn - Austin TX" />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>Breadcrumbs (visible only on a sub-route, e.g. /dev/ui/sub)</SectionLabel>
        <Breadcrumbs />
        <p className="text-[12px] text-ink3">Renders null here since /dev/ui is a top-level route.</p>
      </Card>

      <Card className="p-5 space-y-4">
        <SectionLabel>Button — variants x sizes</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {(['primary', 'dark', 'outline', 'secondary', 'ghost', 'destructive', 'ai'] as const).map((variant) => (
            <Button key={variant} variant={variant} size="sm">{variant}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button loading>Saving…</Button>
          <Button variant="outline" loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <SectionLabel>IconButton</SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton aria-label="Search" size="sm"><Search className="h-3.5 w-3.5" /></IconButton>
          <IconButton aria-label="Search" size="md"><Search className="h-4 w-4" /></IconButton>
          <IconButton aria-label="Search" size="lg" variant="outline"><Search className="h-4 w-4" /></IconButton>
          <IconButton aria-label="Saving" loading />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>EmptyState</SectionLabel>
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No rooms assigned yet"
          body="Assigned rooms will show up here once a supervisor builds today's board."
          action={<Button size="sm" variant="outline">Refresh</Button>}
        />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>StateBlock</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={stateDemo === 'loading' ? 'primary' : 'outline'} onClick={() => setStateDemo('loading')}>loading</Button>
          <Button size="sm" variant={stateDemo === 'empty' ? 'primary' : 'outline'} onClick={() => setStateDemo('empty')}>empty</Button>
          <Button size="sm" variant={stateDemo === 'error' ? 'primary' : 'outline'} onClick={() => setStateDemo('error')}>error</Button>
          <Button size="sm" variant={stateDemo === null ? 'primary' : 'outline'} onClick={() => setStateDemo(null)}>ready</Button>
        </div>
        <div className="rounded-[var(--r-lg)] border border-line-2 min-h-[140px]">
          <StateBlock
            status={stateDemo}
            empty={{ icon: <Bed className="h-5 w-5" />, title: 'No rooms to show' }}
            error={{ message: 'Could not load rooms.', onRetry: () => setStateDemo(null) }}
          >
            <div className="p-5 text-[13px] text-ink2">Data loaded — this is the children slot.</div>
          </StateBlock>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>Toast (useToast)</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast.success('Room 214 marked clean.')}>
            <CheckCircle2 className="h-3.5 w-3.5" /> success
          </Button>
          <Button size="sm" variant="outline" onClick={() => toast.error('Could not save — try again.')}>
            <AlertCircle className="h-3.5 w-3.5" /> error
          </Button>
          <Button size="sm" variant="outline" onClick={() => toast.info('Sync will run in the background.')}>info</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>CommandPalette</SectionLabel>
        <p className="text-[12px] text-ink3">Press ⌘K / Ctrl+K anywhere on this page — it lists only your role&apos;s allowed routes.</p>
      </Card>

      <Card className="p-5 space-y-3">
        <SectionLabel>MobileFloorNav</SectionLabel>
        <p className="text-[12px] text-ink3">Only renders below the md breakpoint, and only for housekeeper/engineer/front_desk roles. Mounted at the bottom of this page — resize the viewport to see it.</p>
      </Card>

      <CommandPalette />
      <MobileFloorNav />
    </div>
  )
}
