'use client'

import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Task } from '@/lib/api/tasks'

type StepTone = 'done' | 'active' | 'alert' | 'pending'

interface Step {
  key: string
  label: string
  detail?: string
  tone: StepTone
}

const TONE_DOT: Record<StepTone, string> = {
  done: 'var(--ink-3)',
  active: 'var(--progress)',
  alert: 'var(--alert)',
  pending: 'transparent',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function profileName(profile?: { preferred_name?: string | null; full_name?: string | null } | null): string | undefined {
  return profile?.preferred_name ?? profile?.full_name ?? undefined
}

/**
 * Built only from fields the backend actually populates — no invented timestamps.
 * There is no `assigned_at` column, so the Assigned step never claims a time,
 * only who assigned it to whom (assigned_by / assigned_to, both real columns).
 */
function buildSteps(t: TFunction, task: Task): Step[] {
  const steps: Step[] = []
  const assigneeName = profileName(task.user_profiles)
  const creatorName = profileName(task.creator_profile)
  const assignerName = profileName(task.assigner_profile)

  steps.push({
    key: 'created',
    tone: 'done',
    label: t('tasks.detail.timeline.created'),
    detail: creatorName
      ? t('tasks.detail.timeline.atBy', { time: formatTime(task.created_at), name: creatorName })
      : formatTime(task.created_at),
  })

  if (task.assigned_to) {
    steps.push({
      key: 'assigned',
      tone: 'done',
      label: t('tasks.detail.timeline.assigned'),
      detail: assignerName
        ? t('tasks.detail.timeline.assignedToBy', { name: assigneeName ?? t('tasks.createModal.unassigned'), by: assignerName })
        : t('tasks.detail.timeline.assignedTo', { name: assigneeName ?? t('tasks.createModal.unassigned') }),
    })
  }

  if (task.started_at) {
    steps.push({
      key: 'started',
      tone: 'active',
      label: t('tasks.detail.timeline.started'),
      detail: assigneeName
        ? t('tasks.detail.timeline.atBy', { time: formatTime(task.started_at), name: assigneeName })
        : formatTime(task.started_at),
    })
  } else if (task.status === 'open') {
    steps.push({ key: 'started', tone: 'pending', label: t('tasks.detail.timeline.started'), detail: t('tasks.detail.timeline.notYet') })
  }

  if (task.status === 'escalated' && task.escalated_at) {
    steps.push({ key: 'escalated', tone: 'alert', label: t('tasks.detail.timeline.escalated'), detail: formatTime(task.escalated_at) })
  }

  if (task.completed_at) {
    steps.push({
      key: 'completed',
      tone: 'done',
      label: t('tasks.detail.timeline.completed'),
      detail: assigneeName
        ? t('tasks.detail.timeline.atBy', { time: formatTime(task.completed_at), name: assigneeName })
        : formatTime(task.completed_at),
    })
  } else if (task.status === 'cancelled' && task.cancelled_at) {
    steps.push({ key: 'cancelled', tone: 'alert', label: t('tasks.detail.timeline.cancelled'), detail: formatTime(task.cancelled_at) })
  } else {
    steps.push({
      key: 'completed',
      tone: 'pending',
      label: t('tasks.detail.timeline.completed'),
      detail: task.due_at ? t('tasks.detail.timeline.notYetDue', { time: formatTime(task.due_at) }) : t('tasks.detail.timeline.notYet'),
    })
  }

  return steps
}

export function TaskTimeline({ task }: { task: Task }) {
  const { t } = useTranslation()
  const steps = buildSteps(t, task)

  return (
    <div>
      <p className="text-xs font-medium text-ink3 mb-3">{t('tasks.detail.timeline.heading')}</p>
      <div className="flex flex-col">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1
          const isDoneTone = step.tone === 'done' || step.tone === 'active' || step.tone === 'alert'
          return (
            <div key={step.key} className="flex gap-3">
              <div className="flex w-5 shrink-0 flex-col items-center">
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={isDoneTone
                    ? { background: TONE_DOT[step.tone] }
                    : { background: 'var(--surface)', border: '2px solid var(--ink4)' }}
                />
                {!isLast && <span className="mt-[2px] w-px flex-1 bg-line" style={{ minHeight: 26 }} />}
              </div>
              <div className={isLast ? 'pb-0.5' : 'pb-[18px]'}>
                <p className={`text-[13px] font-semibold ${step.tone === 'pending' ? 'text-ink4' : 'text-ink'}`}>{step.label}</p>
                {step.detail && (
                  <p className={`mt-0.5 text-xs ${step.tone === 'pending' ? 'text-ink4' : 'text-ink3'}`}>{step.detail}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
