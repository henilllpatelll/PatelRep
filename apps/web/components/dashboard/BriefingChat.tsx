'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send } from 'lucide-react'
import { SparkIcon } from '@/components/ui/primitives'
import { useAuthStore } from '@/stores/authStore'
import { useCopilotThreadStore, getCopilotHistoryKey } from '@/stores/copilotThreadStore'
import { answerBriefingQuestion, type BriefingBoardStats } from '@/lib/ai/briefingFastPath'

function detectRoomFilter(question: string): 'DEPARTURE' | 'VACANT' | undefined {
  const q = question.toLowerCase()
  if (/checkout|check-out|check out|departure/.test(q)) return 'DEPARTURE'
  if (/vacant/.test(q)) return 'VACANT'
  return undefined
}

export function BriefingChat({
  stats,
  onClose,
  onOpenRoomFilter,
}: {
  stats: BriefingBoardStats
  onClose: () => void
  onOpenRoomFilter: (filter: 'DEPARTURE' | 'VACANT') => void
}) {
  const user = useAuthStore((s) => s.user)
  const messages = useCopilotThreadStore((s) => s.messages)
  const loading = useCopilotThreadStore((s) => s.loading)
  const hydrate = useCopilotThreadStore((s) => s.hydrate)
  const sendMessage = useCopilotThreadStore((s) => s.sendMessage)

  const [input, setInput] = useState('')
  const [revealLengths, setRevealLengths] = useState<Record<string, number>>({})
  // Gate all mount-time motion behind the 620ms entrance animation: until then
  // nothing inside the panel typewriters or grabs focus, so the whole column
  // drifts up as one block without the caret snapping in or history streaming.
  const [ready, setReady] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const animatedIds = useRef<Set<string>>(new Set())
  const prevCountRef = useRef<number | null>(null)
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  const historyKey = getCopilotHistoryKey(user?.id)
  useEffect(() => {
    if (historyKey) hydrate(historyKey)
  }, [historyKey, hydrate])

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 620)
    return () => clearTimeout(t)
  }, [])

  // Focus the composer only after the entrance drift finishes.
  useEffect(() => {
    if (ready) inputRef.current?.focus({ preventScroll: true })
  }, [ready])

  // Only stream-reveal AI messages that arrive while this panel is open — the
  // initial greeting, hydrated history, and anything answered elsewhere show in
  // full. While the entrance animation is still running (`!ready`) everything on
  // screen is treated as already-seen so it never typewriters mid-drift.
  useEffect(() => {
    if (!ready) {
      for (const m of messages) animatedIds.current.add(m.id)
      prevCountRef.current = messages.length
      return
    }
    const prevCount = prevCountRef.current ?? messages.length
    if (messages.length <= prevCount) {
      prevCountRef.current = messages.length
      return
    }
    const newOnes = messages.slice(prevCount)
    prevCountRef.current = messages.length
    for (const m of newOnes) {
      if (m.role !== 'ai' || animatedIds.current.has(m.id)) continue
      animatedIds.current.add(m.id)
      const content = m.content
      let i = 0
      setRevealLengths((prev) => ({ ...prev, [m.id]: 0 }))
      const timer = setInterval(() => {
        i += 1
        setRevealLengths((prev) => ({ ...prev, [m.id]: i }))
        if (i >= content.length) {
          clearInterval(timer)
          delete timersRef.current[m.id]
        }
      }, 16)
      timersRef.current[m.id] = timer
    }
  }, [messages, ready])

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearInterval)
  }, [])

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
  }, [messages, revealLengths, loading])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    setInput('')
    const filter = detectRoomFilter(trimmed)
    sendMessage(trimmed, { preAnswer: (text) => answerBriefingQuestion(text, stats) })
    if (filter) onOpenRoomFilter(filter)
  }

  return (
    <div className="flex flex-col gap-3 min-w-0 h-full">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <SparkIcon size={12} className="text-[#b39ce0]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[#b39ce0]">
            Asking about this briefing
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-[#3d3056] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-1"
        style={{ maxHeight: 150 }}
        aria-live="polite"
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div
                className="max-w-[85%] px-3 py-1.5 text-[12.5px] text-[#f7f4ee]"
                style={{ background: 'rgba(255,255,255,.10)', borderRadius: '11px 11px 3px 11px' }}
              >
                {m.content}
              </div>
            </div>
          ) : (
            <p key={m.id} className="font-display italic text-[15.5px] leading-[1.4] text-[#f7f4ee]">
              {revealLengths[m.id] != null ? m.content.slice(0, revealLengths[m.id]) : m.content}
            </p>
          )
        )}
        {loading && (
          <div className="flex items-center gap-1 h-[15px]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#b39ce0] dot-bob" style={{ animationDelay: '0ms' }} />
            <span className="w-[5px] h-[5px] rounded-full bg-[#b39ce0] dot-bob" style={{ animationDelay: '150ms' }} />
            <span className="w-[5px] h-[5px] rounded-full bg-[#b39ce0] dot-bob" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 mt-auto">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSend() }
          }}
          placeholder="Ask about the briefing…"
          aria-label="Ask about the briefing"
          disabled={loading}
          className="flex-1 h-[34px] px-3 text-[12.5px] text-[#f7f4ee] placeholder:text-white/40 focus:outline-none"
          style={{
            background: 'rgba(255,255,255,.05)',
            border: '1px solid rgba(255,255,255,.14)',
            borderRadius: 9,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          aria-label="Send"
          className="w-[34px] h-[34px] shrink-0 flex items-center justify-center transition-colors disabled:cursor-not-allowed"
          style={{
            borderRadius: 9,
            background: input.trim() ? '#b8431c' : 'rgba(255,255,255,.08)',
            color: input.trim() ? '#fff' : 'rgba(255,255,255,.4)',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
