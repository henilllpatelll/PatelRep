'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Bot, Send, CheckCircle, Wrench, Bed,
  AlertTriangle, Activity, Zap,
} from 'lucide-react'
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
import { Card } from '@/components/ui/Card'
import { clientFastPath, isOffTopic, OFF_TOPIC_RESPONSE } from '@/lib/ai/clientFastPath'
import {
  AssignmentCard,
  GuestRequestCard,
  InsightsView,
  TaskPreviewCard,
  WorkOrderCard,
} from '@/components/ai/cards'

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2) }

// ── Preview Cards ─────────────────────────────────────────────────────────────

// ── Confirm View ──────────────────────────────────────────────────────────────

function ConfirmView<T>({
  items, onConfirm, onCancel, renderItem, label,
}: { items: T[]; onConfirm: () => Promise<void>; onCancel: () => void; renderItem: (item: T, i: number) => React.ReactNode; label: string }) {
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setSaving(true)
    try { await onConfirm(); setDone(true) } finally { setSaving(false) }
  }

  if (done) return (
    <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-2">
      <CheckCircle size={14} /> {label}
    </div>
  )

  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-2 max-h-60 overflow-y-auto">{items.map((item, i) => renderItem(item, i))}</div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || items.length === 0}
          className="flex-1 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Creating…' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 border border-stone-300 text-sm font-medium text-stone-600 rounded-lg hover:bg-stone-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Task Confirm (with edit) ──────────────────────────────────────────────────

function TaskConfirmView({ data, onConfirm, onCancel }: { data: TaskPreviewResponse; onConfirm: (tasks: ParsedTask[]) => void; onCancel: () => void }) {
  const [tasks, setTasks] = useState(data.tasks)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setSaving(true)
    try { await onConfirm(tasks); setDone(true) } finally { setSaving(false) }
  }

  if (done) return (
    <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-2">
      <CheckCircle size={14} /> {tasks.length} task{tasks.length !== 1 ? 's' : ''} created.
    </div>
  )

  return (
    <div className="mt-2 space-y-2">
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {tasks.map((task, i) => <TaskPreviewCard key={i} task={task} />)}
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || tasks.length === 0}
          className="flex-1 py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? 'Creating…' : 'Confirm & Create'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 border border-stone-300 text-sm font-medium text-stone-600 rounded-lg hover:bg-stone-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Message Renderer ──────────────────────────────────────────────────────────

interface ChatMsg { id: string; role: 'user' | 'ai'; content: string; responseData?: CopilotResponse }

function AiMessage({ msg, onConfirmTasks, onConfirmWorkOrders, onConfirmGuestRequests, onConfirmAssignments, onCancel, onResendWithHint, originalUserMessage }: {
  msg: ChatMsg
  onConfirmTasks: (tasks: ParsedTask[]) => void
  onConfirmWorkOrders: (wos: WorkOrderPreview[]) => Promise<void>
  onConfirmGuestRequests: (reqs: GuestRequestPreview[]) => Promise<void>
  onConfirmAssignments: (assignments: AssignmentPreview[]) => Promise<void>
  onCancel: () => void
  onResendWithHint: (msg: string, hint: string) => void
  originalUserMessage: string
}) {
  const d = msg.responseData
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-amber-200">
        <Bot size={15} className="text-white" />
      </div>
      <div className="flex-1 bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-stone-800 max-w-2xl">
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
            label={`${(d as WorkOrderPreviewResponse).work_orders.length} work order${(d as WorkOrderPreviewResponse).work_orders.length !== 1 ? 's' : ''} created.`}
          />
        )}
        {d?.response_type === 'guest_request_preview' && (
          <ConfirmView
            items={(d as GuestRequestPreviewResponse).requests}
            onConfirm={() => onConfirmGuestRequests((d as GuestRequestPreviewResponse).requests)}
            onCancel={onCancel}
            renderItem={(req, i) => <GuestRequestCard key={i} req={req} />}
            label={`${(d as GuestRequestPreviewResponse).requests.length} guest request${(d as GuestRequestPreviewResponse).requests.length !== 1 ? 's' : ''} logged.`}
          />
        )}
        {d?.response_type === 'assignment_preview' && (
          <ConfirmView
            items={(d as AssignmentPreviewResponse).assignments}
            onConfirm={() => onConfirmAssignments((d as AssignmentPreviewResponse).assignments)}
            onCancel={onCancel}
            renderItem={(a, i) => <AssignmentCard key={i} assignment={a} />}
            label="Assignments saved."
          />
        )}
        {d?.response_type === 'ambiguous' && (
          <div className="flex gap-2 flex-wrap mt-3">
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
          <div className="mt-3 flex flex-wrap gap-2">
            {(d as any).actions.map((a: any, i: number) => (
              <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">{a.label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Risk Alerts Sidebar ───────────────────────────────────────────────────────

function RiskAlertsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts().then((r) => r.data),
    refetchInterval: 60_000,
  })

  const total = (data?.housekeeping_risks?.length ?? 0) + (data?.sla_breaches?.length ?? 0) + (data?.maintenance_risks?.length ?? 0)

  return (
    <div className="w-72 shrink-0 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Activity size={15} className="text-amber-500" />
        <h2 className="text-sm font-semibold text-stone-800">Live Risk Alerts</h2>
        {!isLoading && total > 0 && (
          <span className="ml-auto text-xs bg-red-100 text-red-600 font-medium px-2 py-0.5 rounded-full">{total}</span>
        )}
      </div>

      {isLoading && <p className="text-xs text-stone-400">Loading…</p>}

      {!isLoading && total === 0 && (
        <Card className="p-4">
          <p className="text-xs text-stone-400 text-center">No active alerts</p>
        </Card>
      )}

      {(data?.sla_breaches?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-red-500" /> SLA Breaches
          </p>
          {data!.sla_breaches.map((b) => (
            <div key={b.work_order_number} className="border-l-2 border-red-400 pl-2">
              <p className="text-xs font-medium text-stone-800">{b.title}</p>
              <p className="text-xs text-stone-400">#{b.work_order_number} · overdue {formatDistanceToNow(new Date(b.due_at))}</p>
            </div>
          ))}
        </Card>
      )}

      {(data?.housekeeping_risks?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide flex items-center gap-1.5">
            <Bed size={12} className="text-amber-500" /> Room Risks
          </p>
          {data!.housekeeping_risks.map((r) => (
            <div key={r.room_id} className="border-l-2 border-amber-400 pl-2">
              <p className="text-xs font-medium text-stone-800">Room {r.rooms?.room_number}</p>
              <p className="text-xs text-stone-400">High risk · ready {formatDistanceToNow(new Date(r.predicted_ready_at), { addSuffix: true })}</p>
            </div>
          ))}
        </Card>
      )}

      {(data?.maintenance_risks?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide flex items-center gap-1.5">
            <Wrench size={12} className="text-stone-500" /> Asset Risks
          </p>
          {data!.maintenance_risks.map((a) => (
            <div key={a.name} className="border-l-2 border-stone-300 pl-2">
              <p className="text-xs font-medium text-stone-800">{a.name}</p>
              <p className="text-xs text-stone-400">Failure risk {a.failure_risk_score}%</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ── Quick Actions ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS: Record<string, string[]> = {
  gm: ['Show GM insights', 'At-risk rooms today', 'Open work orders'],
  housekeeping_supervisor: ['At-risk rooms today', 'Assign rooms', 'Open tasks'],
  chief_engineer: ['Open work orders', 'Asset risk alerts', 'Overdue PMs'],
  housekeeper: ['My tasks today', 'Request supplies', 'Report issue'],
  engineer: ['My work orders', 'Report repair', 'Mark complete'],
  front_desk: ['Guest request', 'Room status', 'Report issue'],
}
const DEFAULT_ACTIONS = ['At-risk rooms today', 'Open work orders', 'Create task']

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AICopilotPage() {
  const INITIAL: ChatMsg = {
    id: genId(), role: 'ai',
    content: "Hi! I'm your AI Copilot. Tell me about a task, ask about operations, or request insights.",
  }

  const [messages, setMessages] = useState<ChatMsg[]>([INITIAL])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
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

  const addAiMsg = (content: string, responseData?: CopilotResponse) =>
    setMessages((prev) => [...prev, { id: genId(), role: 'ai', content, responseData }])

  const sendMessage = async (text?: string, context?: Record<string, unknown>) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    setMessages((prev) => [...prev, { id: genId(), role: 'user', content: userMsg }])

    // Off-topic filter — skip API entirely
    if (!context && isOffTopic(userMsg)) {
      addAiMsg(OFF_TOPIC_RESPONSE.message, OFF_TOPIC_RESPONSE)
      return
    }

    // Client-side fast path — skip API until confirmation
    if (!context) {
      const fast = clientFastPath(userMsg)
      if (fast) {
        addAiMsg(fast.message, fast)
        return
      }
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

  const handleCancel = () => addAiMsg('No problem — cancelled.')

  const handleResendWithHint = (original: string, hint: string) =>
    sendMessage(original, { intent_hint: hint })

  const getUserMsgBefore = (idx: number) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content
    }
    return ''
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-3.5rem)] p-6">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-sm shadow-amber-200">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-900 leading-tight">AI Copilot</h1>
            <p className="text-xs text-stone-400 leading-tight flex items-center gap-1">
              <Zap size={10} /> Powered by GPT-4o-mini + Claude Sonnet
            </p>
          </div>
        </div>

        <Card className="flex-1 flex flex-col overflow-hidden p-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4" aria-live="polite" aria-label="AI Copilot conversation">
            {messages.map((msg, idx) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-2xl px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm shadow-amber-200">
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
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shrink-0">
                  <Bot size={15} className="text-white" />
                </div>
                <div className="bg-amber-50 border border-amber-100 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full motion-safe:animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick actions */}
          <div className="px-5 pt-3 pb-2 border-t border-stone-100 shrink-0">
            <div className="flex gap-2 flex-wrap">
              {quickActions.map((qa) => (
                <button key={qa} onClick={() => sendMessage(qa)} disabled={loading}
                  className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap">
                  {qa}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="p-4 shrink-0">
            <div className="flex gap-2">
              <input
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Room 412 needs towels… AC broken in 210… Assign Maria to floor 3…"
                aria-label="Message the AI Copilot"
                className="flex-1 text-sm px-4 py-2.5 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 bg-white"
                disabled={loading}
              />
              <button onClick={() => sendMessage()} disabled={loading || !input.trim()} aria-label="Send message"
                className="px-4 py-2.5 bg-gradient-to-br from-amber-400 to-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm shadow-amber-200">
                <Send size={16} />
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* Risk alerts sidebar — supervisors and GMs only */}
      {isSupervisor && (
        <div className="hidden md:block">
          <RiskAlertsPanel />
        </div>
      )}
    </div>
  )
}
