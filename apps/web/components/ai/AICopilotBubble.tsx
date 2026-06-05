'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Send, CheckCircle, ChevronRight } from 'lucide-react'
import {
  AssignmentCard,
  GuestRequestCard,
  InsightsView,
  TaskPreviewCard,
  WorkOrderCard,
} from '@/components/ai/cards'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  aiApi,
  type ParsedTask, type CopilotResponse, type InsightsResponse, type TaskPreviewResponse,
  type WorkOrderPreview, type WorkOrderPreviewResponse,
  type GuestRequestPreview, type GuestRequestPreviewResponse,
  type AssignmentPreview, type AssignmentPreviewResponse,
  type AmbiguousResponse,
} from '@/lib/api/ai'
import { clientFastPath, isOffTopic, OFF_TOPIC_RESPONSE } from '@/lib/ai/clientFastPath'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { usePathname } from 'next/navigation'

type MessageRole = 'user' | 'ai'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  responseData?: CopilotResponse
}

function generateId() { return Math.random().toString(36).slice(2) }

function SparkIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
    </svg>
  )
}

// ── Confirm Views ─────────────────────────────────────────────────────────────

interface ConfirmViewProps<T> {
  items: T[]
  onConfirm: () => Promise<void>
  onCancel: () => void
  renderItem: (item: T, i: number) => React.ReactNode
  confirmLabel: string
}

function ConfirmView<T>({ items, onConfirm, onCancel, renderItem, confirmLabel }: ConfirmViewProps<T>) {
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const handleConfirm = async () => {
    setConfirming(true)
    try { await onConfirm(); setConfirmed(true) } finally { setConfirming(false) }
  }
  if (confirmed) return <div className="flex items-center gap-2 text-ready text-xs font-medium mt-1"><CheckCircle size={12} />{confirmLabel}</div>
  return (
    <div className="mt-1 space-y-2">
      <div className="space-y-1.5 max-h-40 overflow-y-auto">{items.map((item, i) => renderItem(item, i))}</div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleConfirm} disabled={confirming || items.length === 0}
          className="flex-1 py-2 bg-accent text-white text-xs font-medium rounded-[var(--r-sm)] hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-2 border border-line text-xs font-medium text-ink2 rounded-[var(--r-sm)] hover:bg-surface-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

function TaskConfirmView({ data, onConfirm, onCancel }: { data: TaskPreviewResponse; onConfirm: (tasks: ParsedTask[]) => void; onCancel: () => void }) {
  const [tasks, setTasks] = useState<ParsedTask[]>(data.tasks)
  const [editMode, setEditMode] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const handleChange = (i: number, field: keyof ParsedTask, value: string) =>
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)))
  const handleConfirm = async () => {
    setConfirming(true)
    try { await onConfirm(tasks); setConfirmed(true) } finally { setConfirming(false) }
  }
  if (confirmed) return <div className="flex items-center gap-2 text-ready text-xs font-medium mt-1"><CheckCircle size={12} />{tasks.length} task{tasks.length !== 1 ? 's' : ''} created.</div>
  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-ink3">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setEditMode((e) => !e)} className="text-[10.5px] text-ai hover:opacity-80 font-medium">
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {tasks.map((task, i) => <TaskPreviewCard key={i} task={task} index={i} editMode={editMode} onChange={handleChange} />)}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleConfirm} disabled={confirming || tasks.length === 0}
          className="flex-1 py-2 bg-accent text-white text-xs font-medium rounded-[var(--r-sm)] hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-2 border border-line text-xs font-medium text-ink2 rounded-[var(--r-sm)] hover:bg-surface-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── AI message bubble ─────────────────────────────────────────────────────────

function AiMessageBubble({
  msg, onConfirmTasks, onConfirmWorkOrders, onConfirmGuestRequests,
  onConfirmAssignments, onCancel, onResendWithHint, originalUserMessage,
}: {
  msg: ChatMessage
  onConfirmTasks: (tasks: ParsedTask[]) => void
  onConfirmWorkOrders: (wos: WorkOrderPreview[]) => Promise<void>
  onConfirmGuestRequests: (reqs: GuestRequestPreview[]) => Promise<void>
  onConfirmAssignments: (assignments: AssignmentPreview[]) => Promise<void>
  onCancel: (messageId: string) => void
  onResendWithHint: (originalMsg: string, hint: string) => void
  originalUserMessage: string
}) {
  const d = msg.responseData
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-surface border border-line rounded-xl rounded-tl-[4px] px-3 py-2.5 text-sm shadow-sm">
        <p className="font-display italic text-[14px] leading-snug text-ink">{msg.content}</p>
        {d?.response_type === 'task_preview' && (
          <TaskConfirmView data={d as TaskPreviewResponse} onConfirm={onConfirmTasks} onCancel={() => onCancel(msg.id)} />
        )}
        {d?.response_type === 'work_order_preview' && (
          <ConfirmView
            items={(d as WorkOrderPreviewResponse).work_orders}
            onConfirm={() => onConfirmWorkOrders((d as WorkOrderPreviewResponse).work_orders)}
            onCancel={() => onCancel(msg.id)}
            renderItem={(wo, i) => <WorkOrderCard key={i} wo={wo} />}
            confirmLabel={`${(d as WorkOrderPreviewResponse).work_orders.length} work order${(d as WorkOrderPreviewResponse).work_orders.length !== 1 ? 's' : ''} created.`}
          />
        )}
        {d?.response_type === 'guest_request_preview' && (
          <ConfirmView
            items={(d as GuestRequestPreviewResponse).requests}
            onConfirm={() => onConfirmGuestRequests((d as GuestRequestPreviewResponse).requests)}
            onCancel={() => onCancel(msg.id)}
            renderItem={(req, i) => <GuestRequestCard key={i} req={req} />}
            confirmLabel={`${(d as GuestRequestPreviewResponse).requests.length} guest request${(d as GuestRequestPreviewResponse).requests.length !== 1 ? 's' : ''} logged.`}
          />
        )}
        {d?.response_type === 'assignment_preview' && (
          <ConfirmView
            items={(d as AssignmentPreviewResponse).assignments}
            onConfirm={() => onConfirmAssignments((d as AssignmentPreviewResponse).assignments)}
            onCancel={() => onCancel(msg.id)}
            renderItem={(a, i) => <AssignmentCard key={i} assignment={a} />}
            confirmLabel="Assignments saved."
          />
        )}
        {d?.response_type === 'ambiguous' && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {(d as AmbiguousResponse).options.map((opt) => (
              <button key={opt.intent_hint}
                onClick={() => onResendWithHint(originalUserMessage, opt.intent_hint)}
                className="text-[10.5px] bg-ai-soft text-ai border border-ai-line px-2.5 py-1 rounded-full hover:opacity-80 transition-opacity font-medium">
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {d?.response_type === 'insights' && <InsightsView data={d as InsightsResponse} />}
        {d?.response_type === 'answer' && (d as any).actions?.length > 0 && (
          <div className="mt-2 bg-ai-soft border border-ai-line rounded-[var(--r-sm)] p-2 space-y-1">
            {(d as any).actions.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-ink">
                <ChevronRight size={9} className="text-ai shrink-0" />
                {a.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const QUICK_ACTIONS_BY_ROLE: Record<string, string[]> = {
  gm: ['Show GM insights', 'At-risk rooms today', 'Open work orders'],
  housekeeping_supervisor: ['At-risk rooms today', 'Assign rooms', 'Open tasks'],
  chief_engineer: ['Open work orders', 'Asset risk alerts', 'Overdue PMs'],
  housekeeper: ['My tasks today', 'Request supplies', 'Report issue'],
  engineer: ['My work orders', 'Report repair', 'Mark complete'],
  front_desk: ['Guest request', 'Room status', 'Report issue'],
}
const DEFAULT_QUICK_ACTIONS = ['At-risk rooms today', 'Open work orders', 'Create task']

export function AICopilotBubble() {
  const pathname = usePathname()
  const isAiPage = pathname === '/ai'

  const INITIAL_MSG: ChatMessage = {
    id: generateId(), role: 'ai',
    content: "Hi! I'm your AI Copilot. Tell me about a task, ask about operations, or request insights.",
  }

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MSG])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { role } = useRole()
  const user = useAuthStore((s) => s.user)

  const historyKey = user?.id ? `copilot-shift-${user.id}-${format(new Date(), 'yyyy-MM-dd')}` : null

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
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    document.addEventListener('copilot:open', handleOpen)
    return () => document.removeEventListener('copilot:open', handleOpen)
  }, [])

  if (isAiPage) return null

  const quickActions = (role && QUICK_ACTIONS_BY_ROLE[role]) || DEFAULT_QUICK_ACTIONS

  const sendMessage = async (text?: string, context?: Record<string, unknown>) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    setMessages((prev) => [...prev, { id: generateId(), role: 'user', content: userMsg }])

    if (!context && isOffTopic(userMsg)) {
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: OFF_TOPIC_RESPONSE.message, responseData: OFF_TOPIC_RESPONSE }])
      return
    }

    if (!context) {
      const fast = clientFastPath(userMsg)
      if (fast) {
        setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: fast.message, responseData: fast }])
        return
      }
    }

    setLoading(true)
    try {
      const res = await aiApi.chat(userMsg, context)
      const data = res.data
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: data.message || "I've processed your request.", responseData: data }])
    } catch {
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmTasks = async (tasks: ParsedTask[]) => {
    await aiApi.confirmTasks(tasks)
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    setTimeout(() => setOpen(false), 1200)
  }
  const handleConfirmWorkOrders = async (wos: WorkOrderPreview[]) => {
    await aiApi.confirmWorkOrders(wos)
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    setTimeout(() => setOpen(false), 1200)
  }
  const handleConfirmGuestRequests = async (reqs: GuestRequestPreview[]) => {
    await aiApi.confirmGuestRequests(reqs)
    queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
    setTimeout(() => setOpen(false), 1200)
  }
  const handleConfirmAssignments = async (assignments: AssignmentPreview[]) => {
    await aiApi.confirmAssignments(assignments)
    queryClient.invalidateQueries({ queryKey: ['assignments'] })
    setTimeout(() => setOpen(false), 1200)
  }

  const handleCancel = (messageId: string) =>
    setMessages((prev) => [
      ...prev.map((msg) => (msg.id === messageId ? { ...msg, responseData: undefined } : msg)),
      { id: generateId(), role: 'ai', content: 'No problem — cancelled.' },
    ])

  const handleResendWithHint = (originalMsg: string, intentHint: string) =>
    sendMessage(originalMsg, { intent_hint: intentHint })

  const getUserMsgBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 md:bottom-6 md:right-6">
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI Copilot chat"
          className="absolute bottom-14 right-0 w-[calc(100vw-2rem)] max-w-[380px] bg-surface border border-line rounded-[var(--r-xl)] shadow-[var(--shadow-pop)] flex flex-col overflow-hidden"
          style={{ height: 'min(500px, calc(100vh - 8rem))' }}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-ink shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-ai flex items-center justify-center">
                <SparkIcon size={11} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-[13px] leading-tight text-paper">PatelRep AI</p>
                <p className="text-[10px] font-mono text-paper/50 leading-tight">Operations Copilot</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close AI Copilot"
              className="text-paper/50 hover:text-paper p-1 rounded transition-colors">
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3" aria-live="polite" aria-label="AI Copilot conversation">
            {messages.map((msg, idx) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-tr-[4px] text-[13px] bg-ink text-paper">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <AiMessageBubble
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
            {loading && (
              <div className="flex justify-start">
                <div className="bg-ai-soft border border-ai-line px-3 py-2 rounded-xl rounded-tl-[4px] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-ai rounded-full motion-safe:animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 pt-2 pb-1 border-t border-line-2 shrink-0">
            <div className="flex gap-1.5 flex-wrap">
              {quickActions.map((qa) => (
                <button key={qa} onClick={() => sendMessage(qa)} disabled={loading}
                  className="min-h-[34px] text-[11px] bg-ai-soft text-ai border border-ai-line px-2.5 py-1 rounded-full hover:opacity-80 disabled:opacity-50 transition-opacity">
                  {qa}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 shrink-0">
            <div className="flex gap-2">
              <input
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage() } }}
                placeholder="Room 412 needs towels…"
                aria-label="Message the AI Copilot"
                className="flex-1 text-sm px-3 py-2 bg-surface-2 border border-line rounded-[var(--r-md)] focus:outline-none focus:ring-1 focus:ring-ai-line text-ink placeholder:text-ink4"
                disabled={loading}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()} aria-label="Send message"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center bg-ai text-white rounded-[var(--r-md)] hover:opacity-90 disabled:opacity-40 transition-opacity">
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI Copilot' : 'Open AI Copilot'}
        className="flex items-center gap-2 px-3.5 py-2.5 bg-ai text-white rounded-full shadow-[var(--shadow-pop)] hover:opacity-90 transition-opacity"
      >
        <SparkIcon size={15} className="text-white" />
        <span className="text-[13px] font-medium hidden sm:inline">Ask copilot</span>
        <span className="font-mono text-[10px] opacity-60 hidden sm:inline">⌘J</span>
      </button>
    </div>
  )
}
