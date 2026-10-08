'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { guestRequestsApi, type SlaPolicy } from '@/lib/api/guest_requests'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  CATEGORY_OPTIONS, DEFAULT_RESPONSE_MINUTES, EMPTY_RULE_FILTERS, IMPACT_OPTIONS, PRIORITY_OPTIONS, categoryLabel, describeRule, filterRules,
  formatDuration, hasRuleFilters, impactLabel, priorityLabel, sortRules, type RuleFilters,
} from '@/lib/settings/slaRules'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsSelect, SettingsTextInput } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { SlaRuleDrawer } from './SlaRuleDrawer'

type Drawer = { kind: 'create' } | { kind: 'edit'; rule: SlaPolicy } | null

export function ServiceSlaSettings() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'

  const [drawer, setDrawer] = useState<Drawer>(null)
  const [deleting, setDeleting] = useState<SlaPolicy | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [filters, setFilters] = useState<RuleFilters>(EMPTY_RULE_FILTERS)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sla-policies', hotelId],
    queryFn: () => guestRequestsApi.listSlaPolicies(),
    enabled: !!hotelId,
    select: (res) => sortRules(res.data ?? []),
  })
  const rules = useMemo(() => data ?? [], [data])
  const visible = useMemo(() => filterRules(rules, filters), [rules, filters])

  const remove = useMutation({
    mutationFn: (rule: SlaPolicy) => guestRequestsApi.deleteSlaPolicy(rule.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sla-policies'] })
      setDeleting(null)
      toast.success('Service SLA deleted.')
    },
    onError: (err) => setDeleteError(errorMessage(err, 'We couldn’t delete this rule. Nothing was changed.')),
  })

  // The API already limits these changes to leadership roles; hiding the buttons is only a courtesy.
  const showSearch = rules.length > 6
  const patch = (next: Partial<RuleFilters>) => setFilters((f) => ({ ...f, ...next }))

  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        level={1}
        title="Service SLAs"
        description="Set response-time expectations for guest-facing requests and operational tasks where supported."
        actions={canManage ? <Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> New Rule</Button> : undefined}
      />

      <SettingsCard aria-labelledby="sla-default-heading" className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <h2 id="sla-default-heading" className="text-sm font-semibold text-ink">Default response target</h2>
        <p className="text-sm text-ink">
          <span className="font-semibold">{formatDuration(DEFAULT_RESPONSE_MINUTES)}</span>
          <span className="text-ink-3"> — used when no rule matches a request. This built-in value isn’t configurable.</span>
        </p>
      </SettingsCard>

      <section aria-labelledby="sla-rules-heading" className="space-y-3">
        <div>
          <h2 id="sla-rules-heading" className="text-sm font-semibold text-ink">SLA rules</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-3">
            A rule matches a request when its category, priority and guest impact each match or are set to Any. If several rules match, the most specific one (most fields set) is used.
            The response target is applied when a request is created, so changes affect new requests only. Rules set a due time; they don’t send alerts or escalate on their own.
          </p>
        </div>

        {isLoading ? <SettingsLoading label="Loading service SLAs…" />
          : isError ? <SettingsError message="We couldn’t load the service SLAs." onRetry={() => refetch()} />
          : rules.length === 0 ? (
            <SettingsEmpty
              icon={<Clock className="h-5 w-5" aria-hidden="true" />}
              title="No SLA rules yet"
              body={`Every request currently gets the default ${formatDuration(DEFAULT_RESPONSE_MINUTES)}. Create a rule to set a different target by category, priority or guest impact.`}
              action={canManage ? <Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> New Rule</Button> : undefined}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                {showSearch && (
                  <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                    <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                    <SettingsTextInput type="search" aria-label="Search rules" placeholder="Search rules…" value={filters.q} onChange={(e) => patch({ q: e.target.value })} className="pl-8" />
                  </div>
                )}
                <SettingsSelect aria-label="Filter by category" value={filters.category} onChange={(e) => patch({ category: e.target.value as RuleFilters['category'] })} className="w-auto">
                  <option value="">All categories</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </SettingsSelect>
                <SettingsSelect aria-label="Filter by priority" value={filters.priority} onChange={(e) => patch({ priority: e.target.value as RuleFilters['priority'] })} className="w-auto">
                  <option value="">All priorities</option>
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </SettingsSelect>
                <SettingsSelect aria-label="Filter by guest impact" value={filters.impact} onChange={(e) => patch({ impact: e.target.value as RuleFilters['impact'] })} className="w-auto">
                  <option value="">All guest impacts</option>
                  {IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </SettingsSelect>
                {hasRuleFilters(filters) && <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_RULE_FILTERS)}>Clear filters</Button>}
              </div>
              {hasRuleFilters(filters) && <p role="status" className="text-xs text-ink-3">Showing {visible.length} of {rules.length} rules that apply to your selection (rules set to Any apply to every value).</p>}

              {visible.length === 0 ? <SettingsEmpty title="No rules match" body="Try clearing a filter." /> : (
                <ul className="space-y-2">
                  {visible.map((rule) => (
                    <li key={rule.id}>
                      <SettingsCard as="article" aria-label={describeRule(rule)} className="flex items-center gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink">{rule.category ? categoryLabel(rule.category) : 'Any category'}</p>
                          <p className="mt-0.5 text-[13px] text-ink-3">
                            {rule.priority ? `${priorityLabel(rule.priority)} priority` : 'Any priority'} · {rule.guest_impact ? `${impactLabel(rule.guest_impact)} guest impact` : 'Any guest impact'}
                          </p>
                        </div>
                        <p className="shrink-0 text-right">
                          <span className="font-mono text-lg font-semibold text-ink">{formatDuration(rule.sla_minutes)}</span>
                          {rule.sla_minutes >= 60 && <span className="block text-xs text-ink-3">{rule.sla_minutes} min</span>}
                        </p>
                        {canManage && (
                          <div className="flex shrink-0 items-center">
                            <Button variant="outline" size="sm" onClick={() => setDrawer({ kind: 'edit', rule })} aria-label={`Edit rule: ${describeRule(rule)}`}>
                              <Pencil size={13} aria-hidden="true" /> Edit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setDeleting(rule) }} aria-label={`Delete rule: ${describeRule(rule)}`} className="ml-1 text-ink-3 hover:text-[var(--alert)]">
                              <Trash2 size={14} aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </SettingsCard>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </section>

      {drawer && (
        <SlaRuleDrawer key={drawer.kind === 'edit' ? drawer.rule.id : 'new'} rule={drawer.kind === 'edit' ? drawer.rule : undefined} rules={rules} onClose={() => setDrawer(null)} />
      )}

      {deleting && (
        <SettingsConfirmDialog
          title="Delete SLA Rule?"
          body={(
            <>
              <p className="font-medium text-ink">{describeRule(deleting)} · {formatDuration(deleting.sla_minutes)}</p>
              <p>Removing this rule may change which target applies to future requests. They’ll use the next most specific matching rule, or the default {formatDuration(DEFAULT_RESPONSE_MINUTES)}.</p>
              <p className="text-ink-3">Requests that were already created keep the response target they were given.</p>
            </>
          )}
          confirmLabel="Delete Rule"
          tone="destructive"
          busy={remove.isPending}
          error={deleteError}
          onCancel={() => { if (!remove.isPending) { setDeleting(null); setDeleteError(null) } }}
          onConfirm={() => { if (!remove.isPending) { setDeleteError(null); remove.mutate(deleting) } }}
        />
      )}
    </div>
  )
}
