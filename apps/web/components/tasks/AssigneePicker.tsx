'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { StaffMember } from '@/lib/api/staff'
import { cn } from '@/lib/utils'
import { getAvatarColor, getInitials } from '@/lib/utils/avatar'

/** Small initials avatar, same visual language as the header's own account avatar. */
export function StaffAvatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full text-white font-semibold', getAvatarColor(name))}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </span>
  )
}

/** One staff row shared by every assignment surface (this picker and
 * TaskNextAction's inline reassign menu) — avatar + name + department + active-task hint. */
export function StaffOptionRow({ member, activeCount }: { member: StaffMember; activeCount?: number }) {
  const { t } = useTranslation()
  return (
    <span className="flex items-center gap-2.5 overflow-hidden">
      <StaffAvatar name={member.full_name} />
      <span className="flex flex-col overflow-hidden">
        <span className="truncate text-sm text-ink">{member.full_name}</span>
        <span className="truncate text-xs text-ink4">
          {member.department_name ? `${member.department_name}` : t(`tasks.roleLabels.${member.role}`, member.role)}
          {activeCount != null ? ` · ${t('tasks.actions.activeTasks', { count: activeCount })}` : ''}
        </span>
      </span>
    </span>
  )
}

interface AssigneePickerProps {
  id?: string
  staff: StaffMember[]
  value: string
  onChange: (userId: string) => void
  workloadByAssignee?: Map<string, number>
  unassignedLabel?: string
  disabled?: boolean
}

/** Value-based staff combobox for create/edit forms — searchable, grouped by
 * relevance (caller pre-sorts `staff`), with an explicit Unassigned option.
 * TaskNextAction's item-based reassign menu shares StaffOptionRow above. */
export function AssigneePicker({ id, staff, value, onChange, workloadByAssignee, unassignedLabel, disabled }: AssigneePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const filtered = useMemo(
    () => staff.filter((member) => member.full_name.toLowerCase().includes(query.trim().toLowerCase())),
    [staff, query],
  )
  const selected = staff.find((member) => member.user_id === value)
  const unassignedText = unassignedLabel ?? t('tasks.createModal.unassigned')

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function select(userId: string) {
    onChange(userId)
    close()
  }

  return (
    <div className="relative" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() } }}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && <StaffAvatar name={selected.full_name} size={20} />}
          <span className={cn('truncate', selected ? 'text-ink' : 'text-ink4')}>{selected ? selected.full_name : unassignedText}</span>
        </span>
        <ChevronDown size={15} className="shrink-0 text-ink4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={t('tasks.actions.assignTo')}
          className="absolute left-0 right-0 z-30 mt-1.5 rounded-[var(--r-md)] border border-line bg-surface p-2 shadow-pop"
        >
          {staff.length > 7 && (
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('tasks.actions.searchStaff')}
              aria-label={t('tasks.actions.searchStaff')}
              className="mb-2 w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            />
          )}
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => select('')}
              className={cn('mb-0.5 block w-full rounded px-2 py-2 text-left text-sm text-ink2 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]', !value && 'bg-[var(--accent-soft)] text-accent')}
            >
              {unassignedText}
            </button>
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-xs text-ink3">{t('tasks.actions.noActiveStaff')}</p>
            ) : filtered.map((member) => (
              <button
                key={member.user_id}
                type="button"
                role="option"
                aria-selected={value === member.user_id}
                onClick={() => select(member.user_id)}
                className={cn('block w-full rounded px-2 py-1.5 text-left hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]', value === member.user_id && 'bg-[var(--accent-soft)]')}
              >
                <StaffOptionRow member={member} activeCount={workloadByAssignee?.get(member.user_id)} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
