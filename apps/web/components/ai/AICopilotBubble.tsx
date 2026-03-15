'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, CheckCircle, AlertCircle, Clock, Wrench, Bed, Users, HelpCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { aiApi, type ParsedTask, type CopilotResponse, type InsightsResponse, type TaskPreviewResponse } from '@/lib/api/ai'
import { useRole } from '@/lib/hooks/useRole'

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'ai'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  responseData?: CopilotResponse
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2)
}

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
  if (c >= 0.9) return null // no badge for high confidence
  if (c >= 0.7) return <span className="text-xs text-amber-500">needs review</span>
  return <span className="text-xs text-red-500">low confidence</span>
}

// ── Task Preview Card ─────────────────────────────────────────────────────────

interface TaskPreviewCardProps {
  task: ParsedTask
  index: number
  editMode: boolean
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
        <input
          className="w-full text-sm font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400/50"
          value={task.title}
          onChange={(e) => onChange(index, 'title', e.target.value)}
        />
      ) : (
        <p className="text-sm font-medium text-gray-900">{task.title}</p>
      )}

      {task.room_number_display && (
        <p className="text-xs text-gray-500">Room {task.room_number_display}</p>
      )}

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

// ── Insights View ─────────────────────────────────────────────────────────────

function InsightsView({ data }: { data: InsightsResponse }) {
  const severityColor = (s: string) => {
    if (s === 'critical') return 'border-l-4 border-red-500 bg-red-50'
    if (s === 'warning') return 'border-l-4 border-amber-400 bg-amber-50'
    return 'border-l-4 border-blue-400 bg-blue-50'
  }
  return (
    <div className="space-y-2 mt-1">
      {data.insights.map((ins, i) => (
        <div key={i} className={`rounded-lg px-3 py-2 ${severityColor(ins.severity)}`}>
          <p className="text-xs font-semibold text-gray-900">{ins.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{ins.detail}</p>
          <p className="text-xs text-indigo-600 mt-1 font-medium">→ {ins.action}</p>
        </div>
      ))}
    </div>
  )
}

// ── Task Confirmation View ────────────────────────────────────────────────────

interface TaskConfirmViewProps {
  data: TaskPreviewResponse
  onConfirm: (tasks: ParsedTask[]) => void
  onCancel: () => void
}

function TaskConfirmView({ data, onConfirm, onCancel }: TaskConfirmViewProps) {
  const [tasks, setTasks] = useState<ParsedTask[]>(data.tasks)
  const [editMode, setEditMode] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleChange = (i: number, field: keyof ParsedTask, value: string) => {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)))
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await onConfirm(tasks)
      setConfirmed(true)
    } finally {
      setConfirming(false)
    }
  }

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 text-green-600 text-sm font-medium mt-1">
        <CheckCircle size={14} />
        {tasks.length} task{tasks.length !== 1 ? 's' : ''} created successfully.
      </div>
    )
  }

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''} to create</span>
        <button
          onClick={() => setEditMode((e) => !e)}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          {editMode ? 'Done editing' : 'Edit'}
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
        {tasks.map((task, i) => (
          <TaskPreviewCard key={i} task={task} index={i} editMode={editMode} onChange={handleChange} />
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleConfirm}
          disabled={confirming || tasks.length === 0}
          className="flex-1 py-1.5 bg-gradient-to-r from-indigo-400 to-indigo-600 text-white text-xs font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {confirming ? 'Creating...' : `Confirm & Create`}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-gray-300 text-xs font-medium text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── AI Message Bubble ─────────────────────────────────────────────────────────

interface AiMessageProps {
  msg: ChatMessage
  onConfirm: (tasks: ParsedTask[]) => void
  onCancelConfirm: () => void
}

function AiMessageBubble({ msg, onConfirm, onCancelConfirm }: AiMessageProps) {
  const isTaskPreview = msg.responseData?.response_type === 'task_preview'
  const isInsights = msg.responseData?.response_type === 'insights'

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-gray-100 text-gray-800 px-3 py-2 rounded-xl text-sm">
        <p>{msg.content}</p>
        {isTaskPreview && msg.responseData && (
          <TaskConfirmView
            data={msg.responseData as TaskPreviewResponse}
            onConfirm={onConfirm}
            onCancel={onCancelConfirm}
          />
        )}
        {isInsights && msg.responseData && (
          <InsightsView data={msg.responseData as InsightsResponse} />
        )}
        {!isTaskPreview && !isInsights && msg.responseData?.response_type === 'answer' &&
          (msg.responseData as any).actions?.length > 0 && (
            <div className="mt-2 space-y-1">
              {(msg.responseData as any).actions.map((a: any, i: number) => (
                <div key={i} className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 rounded px-2 py-1">
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
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateId(),
      role: 'ai',
      content: "Hi! I'm your AI Copilot. Tell me about a task (e.g. 'Room 412 needs extra towels'), ask about operations, or request insights.",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { role } = useRole()

  const quickActions = (role && QUICK_ACTIONS_BY_ROLE[role]) || DEFAULT_QUICK_ACTIONS

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const sendMessage = async (text?: string) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')

    const userChatMsg: ChatMessage = { id: generateId(), role: 'user', content: userMsg }
    setMessages((prev) => [...prev, userChatMsg])
    setLoading(true)

    try {
      const res = await aiApi.chat(userMsg)
      const data = res.data
      const aiContent = data.message || "I've processed your request."

      const aiChatMsg: ChatMessage = {
        id: generateId(),
        role: 'ai',
        content: aiContent,
        responseData: data,
      }
      setMessages((prev) => [...prev, aiChatMsg])
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: 'ai', content: 'Something went wrong. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmTasks = async (tasks: ParsedTask[]) => {
    await aiApi.confirmTasks(tasks)
    // Invalidate tasks queries so any open task list updates
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  const handleCancelConfirm = () => {
    setMessages((prev) => [
      ...prev,
      { id: generateId(), role: 'ai', content: 'No problem — task creation cancelled.' },
    ])
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div
          className="absolute bottom-14 right-0 w-80 bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-2xl flex flex-col"
          style={{ height: '500px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-400/30">
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 rounded-xl text-sm bg-gradient-to-br from-indigo-400 to-indigo-600 text-white shadow-sm shadow-indigo-400/20">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <AiMessageBubble
                  key={msg.id}
                  msg={msg}
                  onConfirm={handleConfirmTasks}
                  onCancelConfirm={handleCancelConfirm}
                />
              )
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-indigo-50/80 border border-indigo-100 px-3 py-2 rounded-xl text-sm text-indigo-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick actions */}
          <div className="px-3 pt-2 pb-1 border-t border-white/60 shrink-0">
            <div className="flex gap-1.5 flex-wrap">
              {quickActions.map((qa) => (
                <button
                  key={qa}
                  onClick={() => sendMessage(qa)}
                  disabled={loading}
                  className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200/50 px-2 py-1 rounded-full hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  {qa}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="p-3 shrink-0">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Room 412 needs towels…"
                className="flex-1 text-sm px-3 py-2 bg-white/70 border border-indigo-200/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400"
                disabled={loading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="p-2 bg-gradient-to-br from-indigo-400 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm shadow-indigo-400/30"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open AI Copilot"
        className="w-11 h-11 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-full shadow-lg shadow-indigo-400/40 flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        <Bot size={20} className="text-white" />
      </button>
    </div>
  )
}
