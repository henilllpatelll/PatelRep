'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, CheckCircle } from 'lucide-react'
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

type MessageRole = 'user' | 'ai'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  responseData?: CopilotResponse
}

function generateId() { return Math.random().toString(36).slice(2) }

// ── Task Preview Card ─────────────────────────────────────────────────────────

// ── Generic Confirm View ──────────────────────────────────────────────────────

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
    try { await onConfirm(); setConfirmed(true) }
    finally { setConfirming(false) }
  }

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-1">
        <CheckCircle size={14} />{confirmLabel}
      </div>
    )
  }

  return (
    <div className="mt-1 space-y-2">
      <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
        {items.map((item, i) => renderItem(item, i))}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleConfirm} disabled={confirming || items.length === 0}
          className="flex-1 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-3 border border-stone-300 text-xs font-medium text-stone-600 rounded-lg hover:bg-stone-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Task Confirm View (existing, keeps edit mode) ─────────────────────────────

interface TaskConfirmViewProps {
  data: TaskPreviewResponse; onConfirm: (tasks: ParsedTask[]) => void; onCancel: () => void
}

function TaskConfirmView({ data, onConfirm, onCancel }: TaskConfirmViewProps) {
  const [tasks, setTasks] = useState<ParsedTask[]>(data.tasks)
  const [editMode, setEditMode] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleChange = (i: number, field: keyof ParsedTask, value: string) =>
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)))

  const handleConfirm = async () => {
    setConfirming(true)
    try { await onConfirm(tasks); setConfirmed(true) }
    finally { setConfirming(false) }
  }

  if (confirmed) return (
    <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-1">
      <CheckCircle size={14} />{tasks.length} task{tasks.length !== 1 ? 's' : ''} created successfully.
    </div>
  )

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-stone-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''} to create</span>
        <button onClick={() => setEditMode((e) => !e)} className="text-xs text-amber-600 hover:text-amber-700 font-medium">
          {editMode ? 'Done editing' : 'Edit'}
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
        {tasks.map((task, i) => (
          <TaskPreviewCard key={i} task={task} index={i} editMode={editMode} onChange={handleChange} />
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleConfirm} disabled={confirming || tasks.length === 0}
          className="flex-1 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-3 border border-stone-300 text-xs font-medium text-stone-600 rounded-lg hover:bg-stone-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── AI Message Bubble ─────────────────────────────────────────────────────────

interface AiMessageProps {
  msg: ChatMessage
  onConfirmTasks: (tasks: ParsedTask[]) => void
  onConfirmWorkOrders: (wos: WorkOrderPreview[]) => Promise<void>
  onConfirmGuestRequests: (reqs: GuestRequestPreview[]) => Promise<void>
  onConfirmAssignments: (assignments: AssignmentPreview[]) => Promise<void>
  onCancel: (messageId: string) => void
  onResendWithHint: (originalMsg: string, hint: string) => void
  originalUserMessage: string
}

function AiMessageBubble({
  msg, onConfirmTasks, onConfirmWorkOrders, onConfirmGuestRequests,
  onConfirmAssignments, onCancel, onResendWithHint, originalUserMessage,
}: AiMessageProps) {
  const d = msg.responseData
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-stone-100 text-stone-800 px-3 py-2 rounded-xl text-sm">
        <p>{msg.content}</p>
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
          <div className="flex gap-2 flex-wrap mt-2">
            {(d as AmbiguousResponse).options.map((opt) => (
              <button key={opt.intent_hint}
                onClick={() => onResendWithHint(originalUserMessage, opt.intent_hint)}
                className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100 transition-colors font-medium">
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {d?.response_type === 'insights' && <InsightsView data={d as InsightsResponse} />}
        {d?.response_type === 'answer' && (d as any).actions?.length > 0 && (
          <div className="mt-2 space-y-1">
            {(d as any).actions.map((a: any, i: number) => (
              <div key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-1">{a.label}</div>
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

  // localStorage shift history
  const historyKey = user?.id ? `copilot-shift-${user.id}-${format(new Date(), 'yyyy-MM-dd')}` : null

  useEffect(() => {
    if (!historyKey) return
    const saved = localStorage.getItem(historyKey)
    if (saved) {
      try { setMessages(JSON.parse(saved)) } catch { /* ignore corrupt */ }
    }
  }, [historyKey])

  useEffect(() => {
    if (historyKey && messages.length > 1) {
      localStorage.setItem(historyKey, JSON.stringify(messages.slice(-50)))
    }
  }, [messages, historyKey])

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const quickActions = (role && QUICK_ACTIONS_BY_ROLE[role]) || DEFAULT_QUICK_ACTIONS

  const sendMessage = async (text?: string, context?: Record<string, unknown>) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    const userChatMsg: ChatMessage = { id: generateId(), role: 'user', content: userMsg }
    setMessages((prev) => [...prev, userChatMsg])

    // Off-topic filter — skip API entirely
    if (!context && isOffTopic(userMsg)) {
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: OFF_TOPIC_RESPONSE.message, responseData: OFF_TOPIC_RESPONSE }])
      return
    }

    // Client-side fast path — skip API until confirmation
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
      setMessages((prev) => [...prev, {
        id: generateId(), role: 'ai',
        content: data.message || "I've processed your request.",
        responseData: data,
      }])
    } catch {
      setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: 'Something went wrong. Please try again.' }])
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

  const handleCancel = (messageId: string) =>
    setMessages((prev) => [
      ...prev.map((msg) => (msg.id === messageId ? { ...msg, responseData: undefined } : msg)),
      { id: generateId(), role: 'ai', content: 'No problem — cancelled.' },
    ])

  const handleResendWithHint = (originalMsg: string, intentHint: string) =>
    sendMessage(originalMsg, { intent_hint: intentHint })

  // Map each AI message to the user message that preceded it (for ambiguous re-send)
  const getUserMsgBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI Copilot chat"
          className="absolute bottom-14 right-0 w-[calc(100vw-2rem)] max-w-80 bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-2xl flex flex-col"
          style={{ height: 'min(500px, calc(100vh - 8rem))' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-sm shadow-amber-200">
                <Bot size={14} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight text-slate-900">PatelRep AI</p>
                <p className="text-xs text-stone-400 leading-tight">Operations Copilot</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close AI Copilot" className="text-stone-400 hover:text-stone-600 hover:bg-stone-100/60 rounded-lg p-1 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite" aria-label="AI Copilot conversation">
            {messages.map((msg, idx) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 rounded-xl text-sm bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm shadow-amber-200">
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
                <div className="bg-amber-50/80 border border-amber-100 px-3 py-2 rounded-xl text-sm text-amber-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 pt-2 pb-1 border-t border-white/60 shrink-0">
            <div className="flex gap-1.5 flex-wrap">
              {quickActions.map((qa) => (
                <button key={qa} onClick={() => sendMessage(qa)} disabled={loading}
                  className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full hover:bg-amber-100 disabled:opacity-50 transition-colors">
                  {qa}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 shrink-0">
            <div className="flex gap-2">
              <input
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Room 412 needs towels…"
                aria-label="Message the AI Copilot"
                className="flex-1 text-sm px-3 py-2 bg-white/70 border border-amber-200/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
                disabled={loading}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()} aria-label="Send message"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm shadow-amber-200">
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close AI Copilot' : 'Open AI Copilot'}
        className="w-11 h-11 bg-gradient-to-br from-amber-400 to-amber-500 rounded-full shadow-lg shadow-amber-200/50 flex items-center justify-center hover:opacity-90 transition-opacity">
        <Bot size={20} className="text-white" />
      </button>
    </div>
  )
}
