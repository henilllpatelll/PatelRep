'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { aiApi, type ParsedTask, type TaskPreviewResponse } from '@/lib/api/ai'
import type { Task } from '@/lib/api/tasks'
import { buildTaskBriefing, buildTaskQueue } from '@/lib/ai/taskQueue'
import { Mono } from '@/components/ui/primitives'

interface TasksAIPanelProps {
  tasks: Task[]
  now: number
  onCreated: () => void
}

/** Dark-shell AI panel for the Tasks page: an instant on-device briefing plus
 *  a natural-language composer that drafts tasks through the AI copilot.
 *  Mirrors the mobile Tasks experience (AIBriefingCard + AI quick-add). */
export function TasksAIPanel({ tasks, now, onCreated }: TasksAIPanelProps) {
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState<ParsedTask[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const briefing = useMemo(() => buildTaskBriefing(buildTaskQueue(tasks, now)), [tasks, now])

  async function handleParse() {
    const message = text.trim()
    if (!message || parsing) return
    setParsing(true)
    setNote(null)
    setPreview(null)
    try {
      const res = await aiApi.chat(message, { intent_hint: 'task_creation', source: 'web_tasks' })
      const data = res.data
      if (data.response_type === 'task_preview' && (data as TaskPreviewResponse).tasks.length > 0) {
        setPreview((data as TaskPreviewResponse).tasks)
        setText('')
      } else {
        setNote('message' in data && data.message ? data.message : "Couldn't turn that into a task — try adding a room or what's needed.")
      }
    } catch {
      setNote('AI is unavailable right now — try again in a moment, or use New task.')
    } finally {
      setParsing(false)
    }
  }

  async function handleCreate() {
    if (!preview || creating) return
    setCreating(true)
    try {
      await aiApi.confirmTasks(preview)
      setPreview(null)
      setNote(`Task${preview.length > 1 ? 's' : ''} created ✨`)
      onCreated()
    } catch {
      setNote('AI is unavailable right now — try again in a moment, or use New task.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="anim-rise rounded-[var(--r-xl)] border border-shell-line bg-shell p-5 space-y-3.5" data-testid="tasks-ai-panel">
      {/* Briefing */}
      <div className="flex items-center gap-1.5">
        <Sparkles size={13} className="text-[#cbb8f0]" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#cbb8f0]">AI Task Briefing</span>
      </div>
      <p className="text-[17px] font-semibold leading-snug text-shell-ink">{briefing.headline}</p>
      {briefing.watchouts.length > 0 && (
        <div className="space-y-1">
          {briefing.watchouts.map((watchout, index) => (
            <div key={index} className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-[var(--caution)]" />
              <span className="text-[12.5px] leading-snug text-shell-ink-2">{watchout}</span>
            </div>
          ))}
        </div>
      )}

      {/* AI draft preview */}
      {preview && (
        <div className="rounded-[var(--r-lg)] border border-[var(--ai-line)] bg-shell-surface p-3.5 space-y-2.5" data-testid="ai-task-preview">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-[#cbb8f0]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#cbb8f0]">
              AI drafted {preview.length > 1 ? `${preview.length} tasks` : 'this task'}
            </span>
          </div>
          {preview.map((task, index) => (
            <div key={index} className="space-y-0.5">
              <p className="text-[13.5px] font-semibold text-shell-ink">{task.title}</p>
              <p className="text-[11.5px] text-shell-ink-3">
                <Mono>{task.priority.toUpperCase()}</Mono>
                {task.room_number_display ? <> · Room <Mono>{task.room_number_display}</Mono></> : null}
                {' · '}{task.task_type.replace('_', ' ')}
              </p>
            </div>
          ))}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {creating && <Loader2 size={13} className="animate-spin" />}Create
            </button>
            <button
              onClick={() => setPreview(null)}
              className="flex-1 rounded-lg border border-shell-line px-4 py-2 text-sm font-medium text-shell-ink-2 transition-colors hover:bg-shell-surface"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {note && <p className="text-[12px] text-shell-ink-2">{note}</p>}

      {/* Composer */}
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleParse() } }}
          placeholder="Add a task in plain words — e.g. “Room 214 needs two extra towels”"
          disabled={parsing}
          className="min-h-[42px] flex-1 rounded-[var(--r-md)] border border-shell-line bg-shell-surface px-3.5 text-[13.5px] text-shell-ink placeholder:text-shell-ink-3 focus:border-[var(--ai-line)] focus:outline-none"
        />
        <button
          onClick={() => void handleParse()}
          disabled={!text.trim() || parsing}
          aria-label="Create task with AI"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--ai)] text-white shadow-[0_2px_10px_var(--ai-glow,rgba(124,58,237,0.35))] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        </button>
      </div>
    </div>
  )
}
