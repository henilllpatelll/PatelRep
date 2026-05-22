'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, CheckCircle, Clock, Wrench, Bed, Users, HelpCircle } from 'lucide-react'
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

function priorityColor(p: string) {
  if (p === 'urgent') return 'text-red-600 bg-red-50 border-red-200'
  if (p === 'normal') return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-gray-500 bg-gray-50 border-gray-200'
}

function taskTypeIcon(t: string) {
  if (t === 'housekeeping') return <Bed size={12} className="shrink-0" />
  if (t === 'engineering') return <Wrench size={12} className="shrink-0" />
  if (t === 'guest_request') return <Users size={12} className="shrink-0" />
  return <HelpCircle size={12} className="shrink-0" />
}

function confidenceLabel(c: number) {
  if (c >= 0.9) return null
  if (c >= 0.7) return <span className="text-xs text-amber-500">needs review</span>
  return <span className="text-xs text-red-500">low confidence</span>
}

// ── Task Preview Card ─────────────────────────────────────────────────────────

interface TaskPreviewCardProps {
  task: ParsedTask; index: number; editMode: boolean
  onChange: (i: number, field: keyof ParsedTask, value: string) => void
}

function TaskPreviewCard({ task, index, editMode, onChange }: TaskPreviewCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-1.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
          {taskTypeIcon(task.task_type)}
          <span className="capitalize">{task.task_type.replace('_', ' ')}</span>
        </div>
        <div className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${priorityColor(task.priority)}`}>
          {task.priority}
        </div>
      </div>
      {editMode ? (
        <input className="w-full text-sm font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
          value={task.title} onChange={(e) => onChange(index, 'title', e.target.value)} />
      ) : (
        <p className="text-sm font-medium text-gray-900">{task.title}</p>
      )}
      {task.room_number_display && <p className="text-xs text-gray-500">Room {task.room_number_display}</p>}
      <div className="flex items-center justify-between">
        {task.due_at && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={10} />
            <span>{new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {confidenceLabel(task.confidence)}
      </div>
    </div>
  )
}

// ── Work Order Preview Card ───────────────────────────────────────────────────

function WorkOrderCard({ wo }: { wo: WorkOrderPreview }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-1 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
          <Wrench size={12} className="shrink-0" />
          <span className="capitalize">{wo.category}</span>
        </div>
        <div className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${priorityColor(wo.priority)}`}>
          {wo.priority}
        </div>
      </div>
      <p className="text-sm font-medium text-gray-900">{wo.title}</p>
      {wo.room_number && <p className="text-xs text-gray-500">Room {wo.room_number}</p>}
    </div>
  )
}

// ── Guest Request Preview Card ────────────────────────────────────────────────

function GuestRequestCard({ req }: { req: GuestRequestPreview }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-1 bg-white">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
        <Users size={12} className="shrink-0" />
        <span>Guest Request</span>
      </div>
      <p className="text-sm font-medium text-gray-900">{req.title}</p>
      {req.room_number && <p className="text-xs text-gray-500">Room {req.room_number}</p>}
      {req.guest_name && <p className="text-xs text-gray-400">{req.guest_name}</p>}
    </div>
  )
}

// ── Assignment Preview Card ───────────────────────────────────────────────────

function AssignmentCard({ assignment }: { assignment: AssignmentPreview }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-1 bg-white">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
        <Users size={12} className="shrink-0" />
        <span>{assignment.staff_name_hint}</span>
        {!assignment.staff_id && <span className="text-amber-500 ml-1">not found</span>}
      </div>
      {assignment.room_numbers.length > 0 && (
        <p className="text-xs text-gray-600">Rooms: {assignment.room_numbers.join(', ')}</p>
      )}
      {assignment.task_ids.length > 0 && (
        <p className="text-xs text-gray-600">{assignment.task_ids.length} task{assignment.task_ids.length !== 1 ? 's' : ''}</p>
      )}
    </div>
  )
}

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
          className="flex-1 py-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 border border-gray-300 text-xs font-medium text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
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
        <span className="text-xs text-gray-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''} to create</span>
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
          className="flex-1 py-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {confirming ? 'Creating...' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-xs font-medium text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Insights View ─────────────────────────────────────────────────────────────

function InsightsView({ data }: { data: InsightsResponse }) {
  const sev = (s: string) => s === 'critical' ? 'border-l-4 border-red-500 bg-red-50' : s === 'warning' ? 'border-l-4 border-amber-400 bg-amber-50' : 'border-l-4 border-blue-400 bg-blue-50'
  return (
    <div className="space-y-2 mt-1">
      {data.insights.map((ins, i) => (
        <div key={i} className={`rounded-lg px-3 py-2 ${sev(ins.severity)}`}>
          <p className="text-xs font-semibold text-gray-900">{ins.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{ins.detail}</p>
          <p className="text-xs text-amber-600 mt-1 font-medium">→ {ins.action}</p>
        </div>
      ))}
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
  onCancel: () => void
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
      <div className="max-w-[90%] bg-gray-100 text-gray-800 px-3 py-2 rounded-xl text-sm">
        <p>{msg.content}</p>
        {d?.response_type === 'task_preview' && (
          <TaskConfirmView data={d as TaskPreviewResponse} onConfirm={onConfirmTasks} onCancel={onCancel} />
        )}
        {d?.response_type === 'work_order_preview' && (
          <ConfirmView
            items={(d as WorkOrderPreviewResponse).work_orders}
            onConfirm={() => onConfirmWorkOrders((d as WorkOrderPreviewResponse).work_orders)}
            onCancel={onCancel}
            renderItem={(wo, i) => <WorkOrderCard key={i} wo={wo} />}
            confirmLabel={`${(d as WorkOrderPreviewResponse).work_orders.length} work order${(d as WorkOrderPreviewResponse).work_orders.length !== 1 ? 's' : ''} created.`}
          />
        )}
        {d?.response_type === 'guest_request_preview' && (
          <ConfirmView
            items={(d as GuestRequestPreviewResponse).requests}
            onConfirm={() => onConfirmGuestRequests((d as GuestRequestPreviewResponse).requests)}
            onCancel={onCancel}
            renderItem={(req, i) => <GuestRequestCard key={i} req={req} />}
            confirmLabel={`${(d as GuestRequestPreviewResponse).requests.length} guest request${(d as GuestRequestPreviewResponse).requests.length !== 1 ? 's' : ''} logged.`}
          />
        )}
        {d?.response_type === 'assignment_preview' && (
          <ConfirmView
            items={(d as AssignmentPreviewResponse).assignments}
            onConfirm={() => onConfirmAssignments((d as AssignmentPreviewResponse).assignments)}
            onCancel={onCancel}
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

  const closeAfterAction = () => setTimeout(() => setOpen(false), 1500)

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
    closeAfterAction()
  }

  const handleConfirmWorkOrders = async (wos: WorkOrderPreview[]) => {
    await aiApi.confirmWorkOrders(wos)
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    closeAfterAction()
  }

  const handleConfirmGuestRequests = async (reqs: GuestRequestPreview[]) => {
    await aiApi.confirmGuestRequests(reqs)
    queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
    closeAfterAction()
  }

  const handleConfirmAssignments = async (assignments: AssignmentPreview[]) => {
    await aiApi.confirmAssignments(assignments)
    queryClient.invalidateQueries({ queryKey: ['assignments'] })
    closeAfterAction()
  }

  const handleCancel = () =>
    setMessages((prev) => [...prev, { id: generateId(), role: 'ai', content: 'No problem — cancelled.' }])

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
                <p className="text-xs text-gray-400 leading-tight">Operations Copilot</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100/60 rounded-lg p-1 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                className="flex-1 text-sm px-3 py-2 bg-white/70 border border-amber-200/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
                disabled={loading}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
                className="p-2 bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm shadow-amber-200">
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} aria-label="Open AI Copilot"
        className="w-11 h-11 bg-gradient-to-br from-amber-400 to-amber-500 rounded-full shadow-lg shadow-amber-200/50 flex items-center justify-center hover:opacity-90 transition-opacity">
        <Bot size={20} className="text-white" />
      </button>
    </div>
  )
}
