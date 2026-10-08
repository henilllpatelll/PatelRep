'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { housekeepingApi, type InspectionTemplate } from '@/lib/api/housekeeping'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  describeStats, duplicateTemplateDraft, emptyTemplateDraft, persistedTemplates, templateStats, toTemplateDraft,
} from '@/lib/settings/inspectionTemplates'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsActionMenu } from '@/components/settings/workspace/SettingsActionMenu'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { TemplateDrawer } from './TemplateDrawer'

type Template = InspectionTemplate & { id: string }
type Drawer = { kind: 'create' } | { kind: 'edit'; template: Template } | { kind: 'duplicate'; template: Template } | null
type Confirm = { kind: 'default' | 'delete'; template: Template } | null

export function InspectionTemplatesSettings() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'

  const [drawer, setDrawer] = useState<Drawer>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inspection-templates', hotelId],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: !!hotelId && canManage,
    select: (res) => persistedTemplates(((res as { data?: InspectionTemplate[] }).data ?? [])),
  })
  const templates: Template[] = useMemo(() => data ?? [], [data])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inspection-templates'] })

  const setDefault = useMutation({
    mutationFn: (template: Template) => housekeepingApi.updateInspectionTemplate(template.id, { is_default: true }),
    // The list only changes after the server confirms, so the UI never shows an unsaved default.
    onSuccess: async (_res, template) => {
      await refresh()
      setConfirm(null)
      toast.success(`“${template.name}” is now the default template.`)
    },
    onError: (err) => setActionError(errorMessage(err, 'We couldn’t change the default template. Nothing was changed.')),
  })

  const remove = useMutation({
    mutationFn: (template: Template) => housekeepingApi.deleteInspectionTemplate(template.id),
    onSuccess: async (_res, template) => {
      await refresh()
      setConfirm(null)
      toast.success(`“${template.name}” was removed.`)
    },
    onError: (err) => setActionError(errorMessage(err, 'We couldn’t delete this template. Nothing was changed.')),
  })

  if (!canManage) {
    return <p className="py-8 text-sm text-ink-3">You don’t have permission to manage inspection templates.</p>
  }

  const busy = setDefault.isPending || remove.isPending
  const hasOthers = (template: Template) => templates.some((t) => t.id !== template.id)
  const closeConfirm = () => { if (!busy) { setConfirm(null); setActionError(null) } }
  const openConfirm = (kind: 'default' | 'delete', template: Template) => { setActionError(null); setConfirm({ kind, template }) }

  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        level={1}
        title="Inspection Templates"
        description="Manage the checklists used to evaluate room quality."
        actions={<Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> New Template</Button>}
      />

      {isLoading ? <SettingsLoading label="Loading inspection templates…" />
        : isError ? <SettingsError message="We couldn’t load the inspection templates." onRetry={() => refetch()} />
        : templates.length === 0 ? (
          <SettingsEmpty
            icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
            title="No inspection templates yet"
            body="Create a template to define your room inspection checklist."
            action={<Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> New Template</Button>}
          />
        ) : (
          <ul className="space-y-3">
            {templates.map((template) => {
              const stats = templateStats(template)
              const isDefault = template.is_default
              return (
                <li key={template.id}>
                  <SettingsCard as="article" aria-label={template.name} className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{template.name}</h3>
                        {isDefault && <span className="rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">Default</span>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-3">{describeStats(stats)}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setDrawer({ kind: 'edit', template })} aria-label={`Edit ${template.name}`}>
                      <Pencil size={13} aria-hidden="true" /> Edit
                    </Button>
                    <SettingsActionMenu
                      label={`More actions for ${template.name}`}
                      items={[
                        { id: 'edit', label: 'Edit', icon: <Pencil size={14} />, onSelect: () => setDrawer({ kind: 'edit', template }) },
                        { id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => setDrawer({ kind: 'duplicate', template }) },
                        ...(isDefault ? [] : [{ id: 'default', label: 'Set as Default', icon: <Star size={14} />, onSelect: () => openConfirm('default', template) }]),
                        {
                          id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, tone: 'destructive' as const,
                          disabled: isDefault && hasOthers(template),
                          disabledReason: 'Set another template as the default first.',
                          onSelect: () => openConfirm('delete', template),
                        },
                      ]}
                    />
                  </SettingsCard>
                </li>
              )
            })}
          </ul>
        )}

      {drawer && (
        <TemplateDrawer
          key={drawer.kind === 'create' ? 'new' : `${drawer.kind}-${drawer.template.id}`}
          templateId={drawer.kind === 'edit' ? drawer.template.id : undefined}
          initial={drawer.kind === 'create' ? emptyTemplateDraft() : drawer.kind === 'edit' ? toTemplateDraft(drawer.template) : duplicateTemplateDraft(drawer.template)}
          isCurrentDefault={drawer.kind === 'edit' && drawer.template.is_default}
          copyOf={drawer.kind === 'duplicate' ? drawer.template.name : undefined}
          onClose={() => setDrawer(null)}
        />
      )}

      {confirm?.kind === 'default' && (
        <SettingsConfirmDialog
          title="Set as default template?"
          body={(
            <>
              <p>“{confirm.template.name}” will be pre-selected whenever a supervisor starts a new inspection.</p>
              <p className="text-ink-3">The current default stops being the default. Inspections that are already completed keep the template they used.</p>
            </>
          )}
          confirmLabel="Set as Default"
          busy={setDefault.isPending}
          error={actionError}
          onCancel={closeConfirm}
          onConfirm={() => { if (!setDefault.isPending) { setActionError(null); setDefault.mutate(confirm.template) } }}
        />
      )}

      {confirm?.kind === 'delete' && (
        <SettingsConfirmDialog
          title="Delete Inspection Template?"
          body={(
            <>
              <p>This template will be removed from the available inspection templates. Existing inspections and historical records must remain intact.</p>
              <p className="font-medium text-ink">“{confirm.template.name}”</p>
            </>
          )}
          confirmLabel="Delete Template"
          tone="destructive"
          busy={remove.isPending}
          error={actionError}
          onCancel={closeConfirm}
          onConfirm={() => { if (!remove.isPending) { setActionError(null); remove.mutate(confirm.template) } }}
        />
      )}
    </div>
  )
}
