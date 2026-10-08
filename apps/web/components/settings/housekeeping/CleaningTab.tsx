'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, RotateCcw } from 'lucide-react'
import { checklistsApi, type ChecklistTemplate } from '@/lib/api/checklists'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  CLEAN_TYPES, CLEAN_TYPE_COPY, addDraftItem, draftsEqual, moveDraftItem, removeDraftItem, toChecklistPayload, toDraftItems,
  updateDraftItem, type ChecklistDraftItem, type CleanType,
} from '@/lib/settings/housekeepingConfig'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsActionFooter } from '@/components/settings/workspace/SettingsActionFooter'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { cn } from '@/lib/utils'
import { ChecklistItemDrawer } from './ChecklistItemDrawer'
import { ChecklistRows } from './ChecklistRows'
import { useInvalidateChecklists } from './useHousekeepingSettings'

type Drawer = { mode: 'add' } | { mode: 'edit'; key: string } | null

export function CleaningTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const toast = useToast()
  const invalidate = useInvalidateChecklists()
  const [active, setActive] = useState<CleanType>('DEP')
  /** `null` means "no local edits": the list shows the saved checklist. */
  const [draft, setDraft] = useState<ChecklistDraftItem[] | null>(null)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [pendingType, setPendingType] = useState<CleanType | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

  const { data: templates, isLoading, isError, refetch } = useQuery({
    queryKey: ['cleaning-checklists'],
    queryFn: () => checklistsApi.list().then((res) => (res as { data: ChecklistTemplate[] }).data),
    staleTime: 60_000,
  })

  const saved = useMemo(() => toDraftItems(templates?.find((t) => t.clean_type === active)?.items), [templates, active])
  const items = draft ?? saved
  const dirty = draft !== null && !draftsEqual(draft, saved)
  const copy = CLEAN_TYPE_COPY[active]

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const edit = (next: ChecklistDraftItem[]) => { setDraft(next); setSaveError(null) }

  function selectType(type: CleanType) {
    if (type === active) return
    if (dirty) setPendingType(type)
    else { setActive(type); setDraft(null); setSaveError(null) }
  }

  const save = useMutation({
    mutationFn: () => checklistsApi.update(active, { items: toChecklistPayload(items) }),
    onSuccess: async () => {
      await invalidate()
      setDraft(null)
      setSaveError(null)
      toast.success(`${copy.title} checklist saved.`)
    },
    // The draft is left exactly as the user had it so nothing typed is lost.
    onError: (err) => setSaveError(errorMessage(err, 'We couldn’t save this checklist. Your changes are still here. Please try again.')),
  })

  const reset = useMutation({
    mutationFn: () => checklistsApi.reset(active),
    onSuccess: async () => {
      await invalidate()
      setDraft(null)
      setSaveError(null)
      setConfirmingReset(false)
      setResetError(null)
      toast.success(`${copy.title} checklist restored to defaults.`)
    },
    onError: (err) => setResetError(errorMessage(err, 'We couldn’t restore the defaults. Nothing was changed.')),
  })

  function onSave() {
    if (save.isPending) return
    if (items.length === 0) { setSaveError('A checklist needs at least one item. Add one, or use Restore Defaults.'); return }
    save.mutate()
  }

  const editing = drawer?.mode === 'edit' ? items.find((item) => item.key === drawer.key) : undefined

  if (isLoading) return <SettingsLoading label="Loading cleaning checklists…" />
  if (isError) return <SettingsError message="We couldn’t load the cleaning checklists." onRetry={() => refetch()} />

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Checklist type" className="flex flex-wrap gap-2">
        <span className="sr-only">Select checklist type</span>
        {CLEAN_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={type === active}
            onClick={() => selectType(type)}
            className={cn(
              'min-h-[44px] rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[36px]',
              type === active ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
            )}
          >
            {CLEAN_TYPE_COPY[type].tab}
          </button>
        ))}
      </div>

      <SettingsCard as="section" aria-labelledby="checklist-heading" className="overflow-clip p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3 id="checklist-heading" className="text-base font-semibold text-ink">{copy.title}</h3>
            <p className="mt-0.5 text-sm text-ink-3">{copy.hint} {items.length} {items.length === 1 ? 'item' : 'items'}.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => { setResetError(null); setConfirmingReset(true) }} disabled={save.isPending}>
              <RotateCcw size={14} aria-hidden="true" /> Restore Defaults
            </Button>
            <Button onClick={() => setDrawer({ mode: 'add' })}><Plus size={14} aria-hidden="true" /> Add Checklist Item</Button>
          </div>
        </div>

        {items.length === 0 ? (
          <SettingsEmpty title="No checklist items" body="Add the tasks housekeepers should complete for this cleaning type, or restore the defaults." />
        ) : (
          <ChecklistRows
            items={items}
            onReorder={edit}
            onMove={(key, direction) => edit(moveDraftItem(items, key, direction))}
            onEdit={(key) => setDrawer({ mode: 'edit', key })}
            onRemove={(key) => edit(removeDraftItem(items, key))}
          />
        )}

        <SettingsActionFooter
          sticky
          dirty={dirty}
          saving={save.isPending}
          onSave={onSave}
          onDiscard={() => { setDraft(null); setSaveError(null) }}
          saveLabel="Save Changes"
          discardLabel="Discard Changes"
          dirtyMessage={`Unsaved changes to ${copy.title}. Staff see the new checklist only after you save.`}
          error={saveError}
        />
      </SettingsCard>

      {drawer && (drawer.mode === 'add' || editing) && (
        <ChecklistItemDrawer
          key={drawer.mode === 'edit' ? drawer.key : 'new'}
          mode={drawer.mode}
          cleaningTitle={copy.title}
          initial={editing ? { section: editing.section, label: editing.label, is_required: editing.is_required } : { section: 'General', label: '', is_required: false }}
          onClose={() => setDrawer(null)}
          onSubmit={(values) => {
            edit(drawer.mode === 'add' ? addDraftItem(items, values) : updateDraftItem(items, drawer.key, values))
            setDrawer(null)
          }}
          onDelete={drawer.mode === 'edit' ? () => { edit(removeDraftItem(items, drawer.key)); setDrawer(null) } : undefined}
        />
      )}

      {pendingType && (
        <SettingsConfirmDialog
          title="Discard unsaved changes?"
          body={<p>You have unsaved changes to the {copy.title} checklist. Switching to {CLEAN_TYPE_COPY[pendingType].tab} will discard them.</p>}
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="destructive"
          onCancel={() => setPendingType(null)}
          onConfirm={() => { setActive(pendingType); setDraft(null); setSaveError(null); setPendingType(null) }}
        />
      )}

      {confirmingReset && (
        <SettingsConfirmDialog
          title="Restore Default Checklist?"
          body={(
            <>
              <p>This will replace the current checklist configuration with its default items. Your custom changes to this checklist will be lost.</p>
              <p className="font-medium text-ink">Only the {copy.title} checklist is affected.</p>
              {dirty && <p>Your unsaved edits to it will also be discarded.</p>}
            </>
          )}
          confirmLabel="Restore Defaults"
          tone="destructive"
          busy={reset.isPending}
          error={resetError}
          onCancel={() => { if (!reset.isPending) { setConfirmingReset(false); setResetError(null) } }}
          onConfirm={() => { if (!reset.isPending) reset.mutate() }}
        />
      )}
    </div>
  )
}
