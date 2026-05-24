'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { FileText, Send, ChevronRight, MessageSquare, History, Settings } from 'lucide-react'
import {
  aiApi,
  type ParsedTask, type CopilotResponse,
  type TaskPreviewResponse, type InsightsResponse,
  type WorkOrderPreview, type WorkOrderPreviewResponse,
  type GuestRequestPreview, type GuestRequestPreviewResponse,
  type AssignmentPreview, type AssignmentPreviewResponse,
  type AmbiguousResponse,
} from '@/lib/api/ai'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { clientFastPath, isOffTopic, OFF_TOPIC_RESPONSE } from '@/lib/ai/clientFastPath'
import {
  AssignmentCard,
  GuestRequestCard,
  InsightsView,
  TaskPreviewCard,
  WorkOrderCard,
} from '@/components/ai/cards'
import { AILabel, Mono, SectionLabel, Bar, Pill } from '@/components/ui/primitives'

function genId() { return Math.random().toString(36).slice(2) }

// ── Spark icon ────────────────────────────────────────────────────────────────

function SparkIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
    </svg>
  )
}

// ── Confirm Views ─────────────────────────────────────────────────────────────

function ConfirmView<T>({
  items, onConfirm, onCancel, renderItem, label,
}: { items: T[]; onConfirm: () => Promise<void>; onCancel: () => void; renderItem: (item: T, i: number) => React.ReactNode; label: string }) {
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const submit = async () => { setSaving(true); try { await onConfirm(); setDone(true) } finally { setSaving(false) } }
  if (done) return <div className="flex items-center gap-2 text-ready text-sm font-medium mt-2">{label}</div>
  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-2 max-h-60 overflow-y-auto">{items.map((item, i) => renderItem(item, i))}</div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || items.length === 0}
          className="flex-1 py-2.5 bg-accent text-white text-xs font-medium rounded-[var(--r-md)] hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Creating…' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 border border-line text-xs font-medium text-ink2 rounded-[var(--r-md)] hover:bg-surface-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

function TaskConfirmView({ data, onConfirm, onCancel }: { data: TaskPreviewResponse; onConfirm: (tasks: ParsedTask[]) => void; onCancel: () => void }) {
  const [tasks, setTasks] = useState(data.tasks)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const submit = async () => { setSaving(true); try { await onConfirm(tasks); setDone(true) } finally { setSaving(false) } }
  if (done) return <div className="text-ready text-sm font-medium mt-2">{tasks.length} task{tasks.length !== 1 ? 's' : ''} created.</div>
  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-2 max-h-60 overflow-y-auto">{tasks.map((task, i) => <TaskPreviewCard key={i} task={task} />)}</div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || tasks.length === 0}
          className="flex-1 py-2.5 bg-accent text-white text-xs font-medium rounded-[var(--r-md)] hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Creating…' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 border border-line text-xs font-medium text-ink2 rounded-[var(--r-md)] hover:bg-surface-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Message types ─────────────────────────────────────────────────────────────

interface ChatMsg { id: string; role: 'user' | 'ai'; content: string; responseData?: CopilotResponse }

// ── AI message card ───────────────────────────────────────────────────────────

function AiMessage({ msg, onConfirmTasks, onConfirmWorkOrders, onConfirmGuestRequests, onConfirmAssignments, onCancel, onResendWithHint, originalUserMessage }: {
  msg: ChatMsg
  onConfirmTasks: (tasks: ParsedTask[]) => void
  onConfirmWorkOrders: (wos: WorkOrderPreview[]) => Promise<void>
  onConfirmGuestRequests: (reqs: GuestRequestPreview[]) => Promise<void>
  onConfirmAssignments: (assignments: AssignmentPreview[]) => Promise<void>
  onCancel: (messageId: string) => void
  onResendWithHint: (msg: string, hint: string) => void
  originalUserMessage: string
}) {
  const d = msg.responseData
  return (
    <div className="flex gap-3 items-start">
      <div className="w-[30px] h-[30px] rounded-full bg-ai text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <SparkIcon size={13} />
      </div>
      <div className="flex-1 max-w-[620px]">
        <div className="bg-surface border border-line rounded-[14px] rounded-tl-[4px] px-4 py-3.5 shadow-sm">
          <p className="font-display italic text-[17px] leading-[1.5] text-ink m-0">{msg.content}</p>

          {d?.response_type === 'task_preview' && (
            <TaskConfirmView data={d as TaskPreviewResponse} onConfirm={onConfirmTasks} onCancel={() => onCancel(msg.id)} />
          )}
          {d?.response_type === 'work_order_preview' && (
            <ConfirmView
              items={(d as WorkOrderPreviewResponse).work_orders}
              onConfirm={() => onConfirmWorkOrders((d as WorkOrderPreviewResponse).work_orders)}
              onCancel={() => onCancel(msg.id)}
              renderItem={(wo, i) => <WorkOrderCard key={i} wo={wo} />}
              label={`${(d as WorkOrderPreviewResponse).work_orders.length} work order${(d as WorkOrderPreviewResponse).work_orders.length !== 1 ? 's' : ''} created.`}
            />
          )}
          {d?.response_type === 'guest_request_preview' && (
            <ConfirmView
              items={(d as GuestRequestPreviewResponse).requests}
              onConfirm={() => onConfirmGuestRequests((d as GuestRequestPreviewResponse).requests)}
              onCancel={() => onCancel(msg.id)}
              renderItem={(req, i) => <GuestRequestCard key={i} req={req} />}
              label={`${(d as GuestRequestPreviewResponse).requests.length} guest request${(d as GuestRequestPreviewResponse).requests.length !== 1 ? 's' : ''} logged.`}
            />
          )}
          {d?.response_type === 'assignment_preview' && (
            <ConfirmView
              items={(d as AssignmentPreviewResponse).assignments}
              onConfirm={() => onConfirmAssignments((d as AssignmentPreviewResponse).assignments)}
              onCancel={() => onCancel(msg.id)}
              renderItem={(a, i) => <AssignmentCard key={i} assignment={a} />}
              label="Assignments saved."
            />
          )}
          {d?.response_type === 'ambiguous' && (
            <div className="flex gap-2 flex-wrap mt-3">
              {(d as AmbiguousResponse).options.map((opt) => (
                <button key={opt.intent_hint}
                  onClick={() => onResendWithHint(originalUserMessage, opt.intent_hint)}
                  className="text-xs bg-ai-soft text-ai border border-ai-line px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity font-medium">
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {d?.response_type === 'insights' && <InsightsView data={d as InsightsResponse} />}
          {d?.response_type === 'answer' && (d as any).actions?.length > 0 && (
            <div className="mt-3 bg-ai-soft border border-ai-line rounded-[var(--r-md)] p-3">
              <p className="text-[10.5px] font-semibold text-ai uppercase tracking-[1px] mb-2">Suggested actions</p>
              <div className="flex flex-col gap-1">
                {(d as any).actions.map((a: any, i: number) => (
                  <button key={i} className="flex items-center gap-2 text-xs text-ink text-left px-1.5 py-1 rounded hover:bg-ai-soft transition-colors">
                    <ChevronRight size={11} className="text-ai shrink-0" />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {d?.response_type && (d as any).sources?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {(d as any).sources.map((s: string, j: number) => (
              <span key={j} className="inline-flex items-center gap-1 text-[11px] text-ink3 bg-surface-2 border border-line-2 px-2 py-0.5 rounded-full">
                <FileText size={10} /> {s}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-ink3">
          <Mono>claude-sonnet-3.5</Mono>
          <AILabel />
        </div>
      </div>
    </div>
  )
}

// ── Right sidebar panels ──────────────────────────────────────────────────────

const QUICK_ACTIONS: Record<string, string[]> = {
  gm: ['Show GM insights', 'At-risk rooms today', 'Open work orders'],
  housekeeping_supervisor: ['At-risk rooms today', 'Assign rooms', 'Open tasks'],
  chief_engineer: ['Open work orders', 'Asset risk alerts', 'Overdue PMs'],
  housekeeper: ['My tasks today', 'Request supplies', 'Report issue'],
  engineer: ['My work orders', 'Report repair', 'Mark complete'],
  front_desk: ['Guest request', 'Room status', 'Report issue'],
}
const DEFAULT_ACTIONS = ['At-risk rooms today', 'Open work orders', 'Create task']

function CreditUsageCard() {
  const { data } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts().then((r) => r.data),
    refetchInterval: 60_000,
  })
  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4">
      <SectionLabel hint="This week">Credit usage</SectionLabel>
      <div className="flex items-baseline gap-1 my-1.5">
        <span className="font-display text-[26px] leading-none text-ink">$0.00</span>
        <span className="text-[12px] text-ink3">of cap</span>
      </div>
      <Bar value={0} max={100} tone="ai" height={5} />
      <div className="flex justify-between text-[11px] text-ink3 mt-1.5">
        <span>{(data?.housekeeping_risks?.length ?? 0) + (data?.maintenance_risks?.length ?? 0)} AI queries</span>
        <Mono>0%</Mono>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AICopilotPage() {
  const INITIAL: ChatMsg = {
    id: genId(), role: 'ai',
    content: "Hi! I'm your AI Copilot. Ask anything about your hotel — rooms, staff, work orders, history. Grounded on your data, citing sources.",
  }

  const [messages, setMessages] = useState<ChatMsg[]>([INITIAL])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { role, isSupervisor } = useRole()
  const user = useAuthStore((s) => s.user)

  const historyKey = user?.id ? `copilot-page-${user.id}-${format(new Date(), 'yyyy-MM-dd')}` : null

  useEffect(() => {
    if (!historyKey) return
    const saved = localStorage.getItem(historyKey)
    if (saved) { try { setMessages(JSON.parse(saved)) } catch { /* ignore */ } }
  }, [historyKey])

  useEffect(() => {
    if (historyKey && messages.length > 1) {
      localStorage.setItem(historyKey, JSON.stringify(messages.slice(-50)))
    }
  }, [messages, historyKey])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const quickActions = (role && QUICK_ACTIONS[role]) || DEFAULT_ACTIONS
  const isFirstPrompt = messages.length === 1 && messages[0].role === 'ai'

  const addAiMsg = (content: string, responseData?: CopilotResponse) =>
    setMessages((prev) => [...prev, { id: genId(), role: 'ai', content, responseData }])

  const sendMessage = async (text?: string, context?: Record<string, unknown>) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    setMessages((prev) => [...prev, { id: genId(), role: 'user', content: userMsg }])

    if (!context && isOffTopic(userMsg)) {
      addAiMsg(OFF_TOPIC_RESPONSE.message, OFF_TOPIC_RESPONSE)
      return
    }

    if (!context) {
      const fast = clientFastPath(userMsg)
      if (fast) { addAiMsg(fast.message, fast); return }
    }

    setLoading(true)
    try {
      const res = await aiApi.chat(userMsg, context)
      const d = res.data
      addAiMsg(d.message || "I've processed your request.", d)
    } catch {
      addAiMsg('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmTasks = async (tasks: ParsedTask[]) => {
    await aiApi.confirmTasks(tasks)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
  const handleConfirmWorkOrders = async (wos: WorkOrderPreview[]) => {
    await aiApi.confirmWorkOrders(wos)
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
  }
  const handleConfirmGuestRequests = async (reqs: GuestRequestPreview[]) => {
    await aiApi.confirmGuestRequests(reqs)
    queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
  }
  const handleConfirmAssignments = async (assignments: AssignmentPreview[]) => {
    await aiApi.confirmAssignments(assignments)
    queryClient.invalidateQueries({ queryKey: ['assignments'] })
  }
  const handleCancel = (messageId: string) => {
    setMessages((prev) => [
      ...prev.map((msg) => (msg.id === messageId ? { ...msg, responseData: undefined } : msg)),
      { id: genId(), role: 'ai', content: 'No problem — cancelled.' },
    ])
  }
  const handleResendWithHint = (original: string, hint: string) =>
    sendMessage(original, { intent_hint: hint })

  const getUserMsgBefore = (idx: number) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex-1 flex flex-col min-w-0 p-5">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Intelligence</p>
            <h1 className="font-display text-[26px] leading-none text-ink font-normal tracking-[-0.2px]">Copilot</h1>
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-line rounded-[var(--r-md)] text-[12.5px] text-ink2 hover:bg-surface-2 transition-colors">
              <History size={13} /> History
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-line rounded-[var(--r-md)] text-[12.5px] text-ink2 hover:bg-surface-2 transition-colors">
              <Settings size={13} /> Model
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1" aria-live="polite" aria-label="AI Copilot conversation">
          {messages.map((msg, idx) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[540px] bg-ink text-paper px-3.5 py-2.5 text-[14px] leading-[1.45] rounded-[14px] rounded-tr-[4px]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <AiMessage
                key={msg.id} msg={msg}
                onConfirmTasks={handleConfirmTasks}
                onConfirmWorkOrders={handleConfirmWorkOrders}
                onConfirmGuestRequests={handleConfirmGuestRequests}
                onConfirmAssignments={handleConfirmAssignments}
                onCancel={handleCancel}
                onResendWithHint={handleResendWithHint}
                originalUserMessage={getUserMsgBefore(idx)}
              />
            )
          )}
          {isFirstPrompt && (
            <div className="ml-[41px] flex flex-wrap gap-2">
              {quickActions.map((qa) => (
                <button key={qa} onClick={() => sendMessage(qa)} disabled={loading}
                  className="px-3 py-1.5 border border-ai-line bg-ai-soft text-ai text-xs font-medium rounded-full hover:opacity-80 disabled:opacity-50 transition-opacity">
                  {qa}
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="flex gap-3 items-start">
              <div className="w-[30px] h-[30px] rounded-full bg-ai flex items-center justify-center shrink-0">
                <SparkIcon size={13} className="text-white" />
              </div>
              <div className="bg-ai-soft border border-ai-line px-4 py-3 rounded-[14px] rounded-tl-[4px] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 mt-3">
          <div className="bg-surface border border-line rounded-[14px] shadow-sm p-3">
            <div className="flex items-start gap-2 mb-2.5">
              <MessageSquare size={14} className="text-ink3 mt-0.5 shrink-0" />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage() } }}
                placeholder="What needs attention right now?"
                aria-label="Message the AI Copilot"
                rows={2}
                className="flex-1 w-full resize-none bg-transparent border-none outline-none text-[14px] text-ink placeholder:text-ink3 leading-snug"
                disabled={loading}
              />
              <span className="font-mono text-[10px] text-ink3 bg-surface-2 px-1.5 py-0.5 rounded border border-line shrink-0 mt-0.5">⌘ ⏎</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-ai text-white text-[12.5px] font-medium rounded-[var(--r-md)] hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm">
                <Send size={12} /> Ask
              </button>
              <button onClick={() => setInput('')} disabled={!input.trim()}
                className="text-[12.5px] text-ink3 hover:text-ink transition-colors disabled:opacity-0">
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside className="w-[300px] shrink-0 border-l border-line flex flex-col gap-3.5 p-4 overflow-y-auto">
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden">
          <div className="px-4 py-3 border-b border-line-2">
            <SectionLabel hint="Try one">Examples</SectionLabel>
          </div>
          <div className="p-1.5">
            {[
              'Show me checkouts running late',
              'Which rooms need to be ready by 3pm?',
              'AC issues this week',
              'Reassign remaining rooms',
              'Cost of reactive vs preventive',
            ].map((s, i) => (
              <button key={i} onClick={() => sendMessage(s)} disabled={loading}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-[var(--r-sm)] text-[12.5px] text-ink text-left hover:bg-surface-2 transition-colors disabled:opacity-50">
                <ChevronRight size={11} className="text-accent shrink-0" />
                <span className="flex-1">{s}</span>
              </button>
            ))}
          </div>
        </div>

        {isSupervisor && <CreditUsageCard />}

        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden">
          <div className="px-4 py-3 border-b border-line-2">
            <SectionLabel>Recent</SectionLabel>
          </div>
          {[
            ['Reassign late checkouts', '14m'],
            ['Quarterly PM plan', '2h'],
            ['Linen par tonight', 'yest'],
          ].map(([t, ago], i) => (
            <div key={i} className="px-4 py-2.5 border-t border-line-2 first:border-t-0 flex items-center gap-2 text-[12.5px]">
              <MessageSquare size={12} className="text-ink3 shrink-0" />
              <span className="flex-1 text-ink">{t}</span>
              <Mono className="text-[10.5px] text-ink3">{ago}</Mono>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
