'use client'

import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { groupChecklist, reorderDraftItems, type ChecklistDraftItem } from '@/lib/settings/housekeepingConfig'
import { IconButton } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

function Row({ item, index, count, onEdit, onRemove, onMove }: {
  item: ChecklistDraftItem
  index: number
  count: number
  onEdit: () => void
  onRemove: () => void
  onMove: (direction: 1 | -1) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  const style = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
  }
  return (
    <li ref={setNodeRef} style={style} className={cn('flex items-center gap-1 bg-surface px-2 py-2 sm:gap-2 sm:px-3', isDragging && 'relative z-10 rounded-[var(--r-md)] shadow-xl ring-1 ring-line')}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder “${item.label}”. Press Space to pick up, arrow keys to move, Space to drop.`}
        className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-[var(--r-sm)] text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:cursor-grabbing sm:h-9"
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1 py-1">
        <p className="break-words text-sm text-ink">{item.label}</p>
        {item.is_required && <span className="mt-1 inline-block rounded-full border border-[var(--caution-line)] bg-[var(--caution-soft)] px-2 py-0.5 text-[11px] font-medium text-ink">Required</span>}
      </div>
      <div className="flex shrink-0 items-center">
        <IconButton variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move “${item.label}” up`} className="h-11 w-9 sm:h-8 sm:w-8">
          <ChevronUp size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" size="sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move “${item.label}” down`} className="h-11 w-9 sm:h-8 sm:w-8">
          <ChevronDown size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit “${item.label}”`} className="h-11 w-9 sm:h-8 sm:w-8">
          <Pencil size={14} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove “${item.label}”`} className="h-11 w-9 text-ink-3 hover:text-[var(--alert)] sm:h-8 sm:w-8">
          <Trash2 size={14} aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  )
}

/** Checklist items grouped under their section headings; drag, keyboard or Move up/down all reorder the draft. */
export function ChecklistRows({ items, onReorder, onMove, onEdit, onRemove }: {
  items: ChecklistDraftItem[]
  onReorder: (items: ChecklistDraftItem[]) => void
  onMove: (key: string, direction: 1 | -1) => void
  onEdit: (key: string) => void
  onRemove: (key: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.key === active.id)
    const to = items.findIndex((item) => item.key === over.id)
    onReorder(reorderDraftItems(items, from, to))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-line">
          {groupChecklist(items).map((group, groupIndex) => (
            <section key={`${group.section}-${groupIndex}`} aria-label={group.section}>
              <h4 className="bg-surface-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{group.section}</h4>
              <ul className="divide-y divide-line">
                {group.items.map(({ item, index }) => (
                  <Row
                    key={item.key}
                    item={item}
                    index={index}
                    count={items.length}
                    onEdit={() => onEdit(item.key)}
                    onRemove={() => onRemove(item.key)}
                    onMove={(direction) => onMove(item.key, direction)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
