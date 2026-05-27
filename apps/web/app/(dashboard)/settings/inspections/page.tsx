'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Plus, CheckCircle2 } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { housekeepingApi, type InspectionTemplate } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  TemplateCard,
  TemplateFormCard,
  type TemplateFormValues,
  EMPTY_TEMPLATE_FORM,
} from '@/components/settings/TemplateForm'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InspectionsSettingsPage() {
  const { hotel } = useHotelStore()
  const { isGM, role } = useRole()
  const canManageTemplates = isGM || role === 'housekeeping_supervisor'

  const [templateFormOpen, setTemplateFormOpen] = useState<'create' | string | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormValues>(EMPTY_TEMPLATE_FORM)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const {
    data: inspectionTemplates = [],
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ['inspection-templates', hotel?.id],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: !!hotel?.id && canManageTemplates,
    select: (res: any) => (res.data ?? []) as InspectionTemplate[],
  })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const saveTemplate = useCallback(async () => {
    if (!hotel?.id) return
    setTemplateSaving(true)
    try {
      const payload = {
        name: templateForm.name.trim(),
        is_default: templateForm.is_default,
        items: templateForm.items
          .filter(item => item.description.trim())
          .map((item, idx) => ({
            section: item.section,
            description: item.description.trim(),
            is_required: item.is_required,
            sort_order: idx,
          })),
      }
      if (templateFormOpen === 'create') {
        await housekeepingApi.createInspectionTemplate(payload)
      } else if (templateFormOpen) {
        await housekeepingApi.updateInspectionTemplate(templateFormOpen, payload)
      }
      setTemplateFormOpen(null)
      await refetchTemplates()
      setToast({
        type: 'success',
        message: templateFormOpen === 'create' ? 'Template created.' : 'Template updated.',
      })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save template.' })
    } finally {
      setTemplateSaving(false)
    }
  }, [hotel, templateFormOpen, templateForm, refetchTemplates])

  const deleteTemplate = useCallback(async (templateId: string) => {
    if (!hotel?.id) return
    try {
      await housekeepingApi.deleteInspectionTemplate(templateId)
      await refetchTemplates()
      setToast({ type: 'success', message: 'Template removed.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to delete template.' })
    }
  }, [hotel, refetchTemplates])

  return (
    <div className="space-y-4 max-w-2xl">
      {toast && (
        <div
          role="alert"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-[var(--ready-soft)] border-[var(--ready-line)] text-green-800'
              : 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-red-800'
          }`}
        >
          <CheckCircle2
            size={16}
            className={toast.type === 'success' ? 'text-[var(--ready)]' : 'text-[var(--alert)]'}
          />
          {toast.message}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Inspection Templates</h2>
          <p className="text-sm text-stone-500 mt-1">
            Define inspection checklists used when supervisors inspect cleaned rooms.
            The default template is pre-selected when starting an inspection.
          </p>
        </div>
        {templateFormOpen !== 'create' && (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setTemplateForm({ ...EMPTY_TEMPLATE_FORM })
              setTemplateFormOpen('create')
            }}
          >
            <Plus size={14} className="inline mr-1.5 -mt-0.5" />
            New Template
          </Button>
        )}
      </div>

      {templateFormOpen === 'create' && (
        <TemplateFormCard
          values={templateForm}
          onChange={setTemplateForm}
          onSave={saveTemplate}
          onCancel={() => setTemplateFormOpen(null)}
          saving={templateSaving}
          isNew
        />
      )}

      {inspectionTemplates.filter(t => t.id !== null).length === 0 &&
        templateFormOpen !== 'create' && (
          <Card className="p-8 text-center">
            <ClipboardList className="w-8 h-8 text-stone-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-stone-500">No custom templates yet</p>
            <p className="text-xs text-stone-400 mt-1">
              Create a template to define your room inspection checklist.
            </p>
          </Card>
        )}

      <div className="space-y-3">
        {inspectionTemplates
          .filter(t => t.id !== null)
          .map(tmpl =>
            templateFormOpen === tmpl.id ? (
              <TemplateFormCard
                key={tmpl.id!}
                values={templateForm}
                onChange={setTemplateForm}
                onSave={saveTemplate}
                onCancel={() => setTemplateFormOpen(null)}
                saving={templateSaving}
              />
            ) : (
              <TemplateCard
                key={tmpl.id!}
                template={tmpl}
                onEdit={() => {
                  setTemplateForm({
                    name: tmpl.name,
                    is_default: tmpl.is_default,
                    items: tmpl.items.map(item => ({
                      section: item.section,
                      description: item.description,
                      is_required: item.is_required,
                    })),
                  })
                  setTemplateFormOpen(tmpl.id!)
                }}
                onDelete={() => deleteTemplate(tmpl.id!)}
              />
            ),
          )}
      </div>
    </div>
  )
}
