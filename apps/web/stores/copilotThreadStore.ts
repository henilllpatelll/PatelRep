import { create } from 'zustand'
import { format } from 'date-fns'
import { aiApi, type CopilotResponse } from '@/lib/api/ai'
import { clientFastPath, isOffTopic, OFF_TOPIC_RESPONSE } from '@/lib/ai/clientFastPath'
import { ApiClientError } from '@/lib/api/client'

// One conversation thread shared by every AI surface (the copilot drawer bubble,
// the shift-briefing inline chat, …) so asking a question in one place shows up
// in the other. Persisted per-user-per-day, same key scheme the bubble used solo.

export type MessageRole = 'user' | 'ai'

export interface ThreadMessage {
  id: string
  role: MessageRole
  content: string
  responseData?: CopilotResponse
}

export function generateId() {
  return Math.random().toString(36).slice(2)
}

export function getCopilotHistoryKey(userId?: string | null): string | null {
  return userId ? `copilot-shift-${userId}-${format(new Date(), 'yyyy-MM-dd')}` : null
}

const INITIAL_MESSAGE: ThreadMessage = {
  id: 'initial',
  role: 'ai',
  content: "Hi! I'm your AI Copilot. Tell me about a task, ask about operations, or request insights.",
}

function persistMessages(historyKey: string | null, messages: ThreadMessage[]) {
  if (!historyKey || messages.length <= 1) return
  try {
    localStorage.setItem(historyKey, JSON.stringify(messages.slice(-50)))
  } catch {
    // localStorage unavailable — thread just won't survive a refresh
  }
}

interface SendOptions {
  context?: Record<string, unknown>
  /** Answer locally (0 credits) instead of hitting the API/off-topic pipeline when it matches. */
  preAnswer?: (text: string) => { message: string } | null
}

interface CopilotThreadStore {
  messages: ThreadMessage[]
  historyKey: string | null
  loading: boolean
  hydrate: (historyKey: string) => void
  addMessage: (msg: ThreadMessage) => void
  sendMessage: (text: string, opts?: SendOptions) => Promise<void>
  cancelResponse: (messageId: string) => void
}

export const useCopilotThreadStore = create<CopilotThreadStore>((set, get) => ({
  messages: [INITIAL_MESSAGE],
  historyKey: null,
  loading: false,

  hydrate: (historyKey) => {
    if (get().historyKey === historyKey) return
    let messages = [INITIAL_MESSAGE]
    try {
      const saved = localStorage.getItem(historyKey)
      if (saved) messages = JSON.parse(saved)
    } catch {
      // ignore corrupt/blocked storage
    }
    set({ historyKey, messages })
  },

  addMessage: (msg) =>
    set((state) => {
      const messages = [...state.messages, msg]
      persistMessages(state.historyKey, messages)
      return { messages }
    }),

  sendMessage: async (text, opts) => {
    const userMsg = text.trim()
    if (!userMsg || get().loading) return

    set((state) => {
      const messages = [...state.messages, { id: generateId(), role: 'user' as const, content: userMsg }]
      persistMessages(state.historyKey, messages)
      return { messages }
    })

    if (opts?.preAnswer) {
      const pre = opts.preAnswer(userMsg)
      if (pre) {
        get().addMessage({ id: generateId(), role: 'ai', content: pre.message })
        return
      }
    }

    if (!opts?.context && isOffTopic(userMsg)) {
      get().addMessage({ id: generateId(), role: 'ai', content: OFF_TOPIC_RESPONSE.message, responseData: OFF_TOPIC_RESPONSE })
      return
    }

    if (!opts?.context) {
      const fast = clientFastPath(userMsg)
      if (fast) {
        get().addMessage({ id: generateId(), role: 'ai', content: fast.message, responseData: fast })
        return
      }
    }

    set({ loading: true })
    try {
      const res = await aiApi.chat(userMsg, opts?.context)
      const data = res.data
      get().addMessage({ id: generateId(), role: 'ai', content: data.message || "I've processed your request.", responseData: data })
    } catch (err) {
      get().addMessage({
        id: generateId(),
        role: 'ai',
        content: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      })
    } finally {
      set({ loading: false })
    }
  },

  cancelResponse: (messageId) =>
    set((state) => {
      const messages = [
        ...state.messages.map((m) => (m.id === messageId ? { ...m, responseData: undefined } : m)),
        { id: generateId(), role: 'ai' as const, content: 'No problem — cancelled.' },
      ]
      persistMessages(state.historyKey, messages)
      return { messages }
    }),
}))
