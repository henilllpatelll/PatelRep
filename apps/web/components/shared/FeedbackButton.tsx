'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, MessageSquareWarning, Send, X } from 'lucide-react'
import { feedbackApi } from '@/lib/api/feedback'
import { getFeedbackRuntimeContext } from '@/lib/utils/feedbackContext'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => textareaRef.current?.focus())
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const resetForm = () => {
    setMessage('')
    setStatus('idle')
  }

  const handleSubmit = async () => {
    const trimmed = message.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    setStatus('idle')
    try {
      const runtime = getFeedbackRuntimeContext(typeof window === 'undefined' ? undefined : window)
      await feedbackApi.submit({
        message: trimmed,
        ...runtime,
      })
      setStatus('success')
      setMessage('')
      window.setTimeout(() => {
        setOpen(false)
        resetForm()
      }, 1200)
    } catch {
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-50 md:bottom-6 md:left-[260px]">
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          className="absolute bottom-14 left-0 flex max-h-[min(520px,calc(100vh-7rem))] w-[calc(100vw-2rem)] max-w-[360px] flex-col overflow-hidden rounded-[var(--r-xl)] border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <MessageSquareWarning size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">Report issue</p>
                <p className="truncate text-[11px] text-ink3">Page context is included</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink3 hover:bg-surface-2 hover:text-ink"
              aria-label="Close feedback"
            >
              <X size={15} />
            </button>
          </div>

          <div className="bg-surface p-3">
            <label className="sr-only" htmlFor="feedback-message">Feedback message</label>
            <textarea
              id="feedback-message"
              ref={textareaRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell me what happened..."
              maxLength={2000}
              className="min-h-[92px] w-full resize-none rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink4 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)]"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-ink4">{message.length}/2000</span>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!message.trim() || submitting}
                className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[var(--r-md)] bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={13} />
                {submitting ? 'Sending' : 'Send'}
              </button>
            </div>
            {status === 'success' && (
              <div className="mt-2 flex items-center gap-2 rounded-[var(--r-md)] border border-ready-line bg-ready-soft px-3 py-2 text-[12px] text-ready">
                <CheckCircle2 size={14} />
                Sent. Thank you.
              </div>
            )}

            {status === 'error' && (
              <div className="mt-2 flex items-center gap-2 rounded-[var(--r-md)] border border-alert-line bg-alert-soft px-3 py-2 text-[12px] text-alert">
                <AlertCircle size={14} />
                Could not send. Try again.
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close feedback' : 'Open feedback'}
        className="flex items-center gap-2 rounded-full bg-ink px-3.5 py-2.5 text-white shadow-[var(--shadow-pop)] transition-opacity hover:opacity-90"
      >
        <MessageSquareWarning size={15} />
        <span className="hidden text-[13px] font-medium sm:inline">Feedback</span>
      </button>
    </div>
  )
}
