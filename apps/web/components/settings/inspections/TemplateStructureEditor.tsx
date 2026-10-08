'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from 'lucide-react'
import {
  SECTION_SUGGESTIONS, addItem, addSection, moveItem, moveSection, removeItem, removeSection, renameSection, updateItem,
  type TemplateDraft, type TemplateErrors,
} from '@/lib/settings/inspectionTemplates'
import { Button, IconButton } from '@/components/ui/Button'
import { SettingsTextInput } from '@/components/settings/workspace/SettingsFormControls'
import { cn } from '@/lib/utils'

const ICON_BTN = 'h-11 w-11 sm:h-8 sm:w-8'

/** Sections with their checks. Pure view over the draft: every change goes through `onChange`. */
export function TemplateStructureEditor({ draft, errors, showErrors, onChange }: {
  draft: TemplateDraft
  errors: TemplateErrors
  showErrors: boolean
  onChange: (next: TemplateDraft) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [newSection, setNewSection] = useState('')

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  function submitSection() {
    const title = newSection.trim()
    if (!title) return
    onChange(addSection(draft, title))
    setNewSection('')
  }

  return (
    <div className="space-y-3">
      {showErrors && errors.general && <p role="alert" className="text-xs text-[var(--alert)]">{errors.general}</p>}

      {draft.sections.map((section, sIndex) => {
        const sectionError = showErrors ? errors.sections[section.key] : undefined
        const hasItemError = showErrors && section.items.some((item) => errors.items[item.key])
        const isCollapsed = collapsed.has(section.key) && !sectionError && !hasItemError
        const panelId = `section-panel-${section.key}`
        return (
          <section key={section.key} aria-label={section.title || 'Untitled section'} className="rounded-[var(--r-md)] border border-line">
            <div className="flex items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
              <IconButton variant="ghost" size="sm" onClick={() => toggle(section.key)} aria-expanded={!isCollapsed} aria-controls={panelId} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${section.title || 'section'}`} className={ICON_BTN}>
                {isCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </IconButton>
              <div className="min-w-0 flex-1">
                <SettingsTextInput
                  aria-label={`Section ${sIndex + 1} title`}
                  aria-invalid={sectionError ? true : undefined}
                  value={section.title}
                  onChange={(e) => onChange(renameSection(draft, section.key, e.target.value))}
                  list="template-section-suggestions"
                  placeholder="Section name"
                  maxLength={60}
                  className="min-h-[36px] border-transparent bg-transparent py-1 text-sm font-semibold uppercase tracking-wide hover:border-line focus-visible:bg-surface"
                />
              </div>
              <span className="shrink-0 px-1 text-xs text-ink-3">{section.items.length} {section.items.length === 1 ? 'check' : 'checks'}</span>
              <IconButton variant="ghost" size="sm" onClick={() => onChange(moveSection(draft, section.key, -1))} disabled={sIndex === 0} aria-label={`Move ${section.title || 'section'} up`} className={ICON_BTN}><ChevronUp size={16} aria-hidden="true" /></IconButton>
              <IconButton variant="ghost" size="sm" onClick={() => onChange(moveSection(draft, section.key, 1))} disabled={sIndex === draft.sections.length - 1} aria-label={`Move ${section.title || 'section'} down`} className={ICON_BTN}><ChevronDown size={16} aria-hidden="true" /></IconButton>
              <IconButton variant="ghost" size="sm" onClick={() => onChange(removeSection(draft, section.key))} aria-label={`Remove section ${section.title || ''}`.trim()} className={cn(ICON_BTN, 'text-ink-3 hover:text-[var(--alert)]')}><Trash2 size={14} aria-hidden="true" /></IconButton>
            </div>
            {sectionError && <p role="alert" className="px-3 pt-2 text-xs text-[var(--alert)]">{sectionError}</p>}

            <div id={panelId} hidden={isCollapsed}>
              <ol className="divide-y divide-line">
                {section.items.map((item, iIndex) => {
                  const error = showErrors ? errors.items[item.key] : undefined
                  const base = `item-${item.key}`
                  return (
                    <li key={item.key} className="space-y-2 px-3 py-3">
                      <div className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-2 w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{iIndex + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <SettingsTextInput
                            id={base}
                            aria-label={`Check ${iIndex + 1} in ${section.title || 'section'}`}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `${base}-error` : undefined}
                            value={item.description}
                            onChange={(e) => onChange(updateItem(draft, section.key, item.key, { description: e.target.value }))}
                            placeholder="What should the inspector check?"
                            maxLength={350}
                          />
                          {error && <p id={`${base}-error`} role="alert" className="mt-1 text-xs text-[var(--alert)]">{error}</p>}
                        </div>
                        <div className="flex shrink-0 items-center">
                          <IconButton variant="ghost" size="sm" onClick={() => onChange(moveItem(draft, section.key, item.key, -1))} disabled={iIndex === 0} aria-label={`Move check ${iIndex + 1} up`} className={ICON_BTN}><ChevronUp size={16} aria-hidden="true" /></IconButton>
                          <IconButton variant="ghost" size="sm" onClick={() => onChange(moveItem(draft, section.key, item.key, 1))} disabled={iIndex === section.items.length - 1} aria-label={`Move check ${iIndex + 1} down`} className={ICON_BTN}><ChevronDown size={16} aria-hidden="true" /></IconButton>
                          <IconButton variant="ghost" size="sm" onClick={() => onChange(removeItem(draft, section.key, item.key))} aria-label={`Remove check ${iIndex + 1}`} className={cn(ICON_BTN, 'text-ink-3 hover:text-[var(--alert)]')}><Trash2 size={14} aria-hidden="true" /></IconButton>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 pl-7">
                        <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-sm text-ink-2">
                          <input type="checkbox" checked={item.is_required} onChange={(e) => onChange(updateItem(draft, section.key, item.key, { is_required: e.target.checked }))} className="h-4 w-4 accent-[var(--accent)]" />
                          Required
                        </label>
                        <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-sm text-ink-2">
                          <input type="checkbox" checked={item.requires_photo_on_fail} onChange={(e) => onChange(updateItem(draft, section.key, item.key, { requires_photo_on_fail: e.target.checked }))} className="h-4 w-4 accent-[var(--accent)]" />
                          Photo required if failed
                        </label>
                      </div>
                    </li>
                  )
                })}
              </ol>
              <div className="border-t border-line px-3 py-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(addItem(draft, section.key))}>
                  <Plus size={14} aria-hidden="true" /> Add Item
                </Button>
              </div>
            </div>
          </section>
        )
      })}

      <datalist id="template-section-suggestions">{SECTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="new-section-title" className="mb-1.5 block text-sm font-medium text-ink-2">New section</label>
          <SettingsTextInput
            id="new-section-title"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitSection() } }}
            list="template-section-suggestions"
            placeholder="e.g. Bathroom"
            maxLength={60}
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="outline" onClick={submitSection} disabled={!newSection.trim()}>
          <Plus size={14} aria-hidden="true" /> Add Section
        </Button>
      </div>
    </div>
  )
}
