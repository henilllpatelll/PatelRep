'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export function AssignmentSidebar() {
  const queryClient = useQueryClient()
  const { selectedDate, selectedShift, rooms } = useHousekeepingStore()
  const [aiLoading, setAiLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const unassignedCount = rooms.filter((room: any) => !room.assigned_to).length
  const dirtyCount = rooms.filter((room: any) => room.status === 'DIRTY' || room.status === 'PICKUP').length

  const handleAiAutoAssign = async () => {
    setAiLoading(true)
    setMessage(null)
    try {
      const result = await housekeepingApi.aiSuggestAssignments(selectedDate, selectedShift ?? undefined)
      const count = (result as any)?.data?.assignments_created ?? (result as any)?.data?.count ?? null

      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['staff-list'] })

      setMessage({
        type: 'success',
        text: count !== null
          ? `AI assigned ${count} room${count !== 1 ? 's' : ''}.`
          : 'AI assignments applied.',
      })
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message || 'AI assignment failed. Please try again.',
      })
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <Card className="w-72 shrink-0 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--ai-soft)] text-[var(--ai)]">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">AI Assignments</h3>
          <p className="mt-0.5 text-xs text-ink3">
            Balance today&apos;s open rooms across the team.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
          <p className="text-[11px] font-medium text-ink3">Unassigned</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink">{unassignedCount}</p>
        </div>
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
          <p className="text-[11px] font-medium text-ink3">Needs work</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink">{dirtyCount}</p>
        </div>
      </div>

      {message && (
        <div className={`mt-3 rounded-[var(--r-md)] border px-3 py-2 text-xs ${
          message.type === 'success'
            ? 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]'
            : 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]'
        }`}>
          {message.text}
        </div>
      )}

      <Button
        variant="primary"
        onClick={handleAiAutoAssign}
        disabled={aiLoading || rooms.length === 0}
        className="mt-4 w-full"
      >
        {aiLoading ? (
          <>
            <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Assigning...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Auto-Assign with AI
          </>
        )}
      </Button>
    </Card>
  )
}
