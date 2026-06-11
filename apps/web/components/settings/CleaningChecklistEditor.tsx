'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RotateCcw, Save, ChevronUp, ChevronDown } from 'lucide-react'
import { checklistsApi, CLEAN_TYPE_NAMES, type ChecklistTemplate, type ChecklistItemInput } from '@/lib/api/checklists'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const CLEAN_TYPES = ['DEP', 'FULL', 'LIGHT', 'DEFAULT'] as const
type CleanType = typeof CLEAN_TYPES[number]

const CHECKLIST_SECTIONS = [
  'Bedroom', 'Bathroom', 'General', 'Amenities', 'Closet', 'Kitchenette', 'Entrance',
]

interface EditableItem {
  _key: number
  section: string
  label: string
  is_required: boolean
}

function toEditable(items: ChecklistTemplate['items']): EditableItem[] {
  return items.map((item, idx) => ({
    _key: idx,
    section: item.section,
    label: item.label,
    is_required: item.is_required,
  }))
}

let keyCounter = 1000

export function CleaningChecklistEditor() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<CleanType>('DEP')
  const [editItems, setEditItems] = useState<EditableItem[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['cleaning-checklists'],
    queryFn: () => checklistsApi.list().then((res: any) => res.data as ChecklistTemplate[]),
    staleTime: 60_000,
  })

  const currentTemplate = templates?.find((t) => t.clean_type === activeTab)

  function getItems(): EditableItem[] {
    if (editItems !== null) return editItems
    return toEditable(currentTemplate?.items ?? [])
  }

  function switchTab(tab: CleanType) {
    if (dirty) {
      if (!confirm('You have unsaved changes. Discard them?')) return
    }
    setActiveTab(tab)
    setEditItems(null)
    setDirty(false)
  }

  function handleItemChange(key: number, field: keyof Omit<EditableItem, '_key'>, value: string | boolean) {
    setEditItems((prev) => {
      const base = prev ?? toEditable(currentTemplate?.items ?? [])
      return base.map((item) => item._key === key ? { ...item, [field]: value } : item)
    })
    setDirty(true)
  }

  function handleAddItem() {
    setEditItems((prev) => {
      const base = prev ?? toEditable(currentTemplate?.items ?? [])
      return [...base, { _key: keyCounter++, section: 'General', label: '', is_required: false }]
    })
    setDirty(true)
  }

  function handleRemoveItem(key: number) {
    setEditItems((prev) => {
      const base = prev ?? toEditable(currentTemplate?.items ?? [])
      return base.filter((item) => item._key !== key)
    })
    setDirty(true)
  }

  function moveItem(key: number, dir: 1 | -1) {
    setEditItems((prev) => {
      const base = prev ?? toEditable(currentTemplate?.items ?? [])
      const idx = base.findIndex((item) => item._key === key)
      if (idx < 0) return base
      const next = idx + dir
      if (next < 0 || next >= base.length) return base
      const reordered = [...base]
      ;[reordered[idx], reordered[next]] = [reordered[next], reordered[idx]]
      return reordered
    })
    setDirty(true)
  }

  const saveMutation = useMutation({
    mutationFn: (items: ChecklistItemInput[]) =>
      checklistsApi.update(activeTab, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaning-checklists'] })
      setEditItems(null)
      setDirty(false)
      showToast('success', 'Checklist saved.')
    },
    onError: () => showToast('error', 'Failed to save checklist.'),
  })

  const resetMutation = useMutation({
    mutationFn: () => checklistsApi.reset(activeTab),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cleaning-checklists'] })
      setEditItems(null)
      setDirty(false)
      showToast('success', 'Checklist restored to defaults.')
    },
    onError: () => showToast('error', 'Failed to reset checklist.'),
  })

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3500)
  }

  function handleSave() {
    const items = getItems()
    const invalid = items.filter((item) => !item.label.trim())
    if (invalid.length > 0) {
      showToast('error', `${invalid.length} item(s) have empty labels.`)
      return
    }
    saveMutation.mutate(items.map(({ section, label, is_required }) => ({ section, label, is_required })))
  }

  function handleReset() {
    if (!confirm(`Reset ${CLEAN_TYPE_NAMES[activeTab]} checklist to defaults?`)) return
    resetMutation.mutate()
  }

  const items = getItems()
  const isBusy = saveMutation.isPending || resetMutation.isPending

  return (
    <div className="space-y-4">
      {/* Clean type tabs */}
      <div className="flex gap-1 flex-wrap">
        {CLEAN_TYPES.map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => switchTab(ct)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === ct
                ? 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]'
                : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100/70 border border-transparent'
            }`}
          >
            {CLEAN_TYPE_NAMES[ct]}
          </button>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm ${
          toast.type === 'success'
            ? 'bg-[var(--ready-soft)] text-[var(--ready)] border border-[var(--ready-line)]'
            : 'bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)]'
        }`}>
          {toast.message}
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-stone-400">Loading checklists…</div>
      ) : (
        <Card>
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-ink">{CLEAN_TYPE_NAMES[activeTab]}</h3>
              <p className="text-xs text-stone-500 mt-0.5">{items.length} items</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={isBusy}
                className="text-xs px-2.5 py-1.5 text-stone-500 flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore Defaults
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={isBusy || !dirty}
                className="text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>

          <div className="divide-y divide-line">
            {items.length === 0 && (
              <p className="px-4 py-6 text-sm text-stone-400 text-center">No items yet. Add one below.</p>
            )}
            {items.map((item, idx) => (
              <div key={item._key} className="flex items-start gap-3 px-4 py-3">
                <div className="flex flex-col gap-0.5 mt-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveItem(item._key, -1)}
                    disabled={idx === 0}
                    className="p-0.5 rounded text-stone-300 hover:text-stone-600 disabled:opacity-20 transition-colors"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(item._key, 1)}
                    disabled={idx === items.length - 1}
                    className="p-0.5 rounded text-stone-300 hover:text-stone-600 disabled:opacity-20 transition-colors"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-[140px_1fr] gap-2 min-w-0">
                  <select
                    value={item.section}
                    onChange={(e) => handleItemChange(item._key, 'section', e.target.value)}
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {CHECKLIST_SECTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => handleItemChange(item._key, 'label', e.target.value)}
                    placeholder="Task description…"
                    className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <label className="flex items-center gap-1.5 mt-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.is_required}
                    onChange={(e) => handleItemChange(item._key, 'is_required', e.target.checked)}
                    className="accent-[var(--accent)] w-3.5 h-3.5"
                  />
                  <span className="text-xs text-stone-500">Required</span>
                </label>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item._key)}
                  className="mt-2 p-1 rounded text-stone-300 hover:text-[var(--alert)] transition-colors shrink-0"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-line">
            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center gap-1.5 text-sm text-[var(--caution)] hover:opacity-80 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Add item
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
