'use client'

import { useEffect, useRef, useState } from 'react'
import { X, BookOpen, Loader2, AlertCircle, Lightbulb, FileText } from 'lucide-react'
import { sopApi, SOPQueryResult, SOPSource, SuggestedTask } from '@/lib/api/sop'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SOPQueryModalProps {
  isOpen: boolean
  onClose: () => void
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:0ms]" />
      <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:150ms]" />
      <span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce [animation-delay:300ms]" />
    </div>
  )
}

function priorityBadgeClass(priority: SuggestedTask['priority']): string {
  if (priority === 'urgent') return 'bg-red-100 text-red-700 border border-red-200'
  if (priority === 'normal') return 'bg-blue-100 text-blue-700 border border-blue-200'
  return 'bg-gray-100 text-gray-500 border border-gray-200'
}

function taskTypeBadgeClass(taskType: SuggestedTask['task_type']): string {
  if (taskType === 'housekeeping') return 'bg-purple-100 text-purple-700'
  if (taskType === 'engineering') return 'bg-amber-100 text-amber-700'
  if (taskType === 'guest_request') return 'bg-teal-100 text-teal-700'
  return 'bg-gray-100 text-gray-600'
}

function taskTypeLabel(taskType: SuggestedTask['task_type']): string {
  if (taskType === 'housekeeping') return 'Housekeeping'
  if (taskType === 'engineering') return 'Engineering'
  if (taskType === 'guest_request') return 'Guest Request'
  return 'General'
}

function SourceCard({ source, index }: { source: SOPSource; index: number }) {
  const simPct = Math.round(source.similarity * 100)
  const simColor =
    simPct >= 85
      ? 'bg-green-100 text-green-700'
      : simPct >= 70
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-gray-100 text-gray-500'

  return (
    <div className="flex gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
      <div className="shrink-0 mt-0.5">
        <FileText size={14} className="text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500">Source {index + 1}</span>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${simColor}`}>
            {simPct}% match
          </span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
          {source.content}
        </p>
      </div>
    </div>
  )
}

function AnswerBlock({ answer }: { answer: string }) {
  // Detect numbered steps (lines starting with "1.", "2.", etc.) and render them
  // as a styled list. Otherwise render as pre-wrap paragraph.
  const lines = answer.split('\n').filter((l) => l.trim() !== '')
  const hasNumberedSteps = lines.some((l) => /^\d+[.)]\s/.test(l.trim()))

  if (hasNumberedSteps) {
    return (
      <div className="space-y-1.5">
        {lines.map((line, i) => {
          const stepMatch = line.trim().match(/^(\d+[.)]\s*)(.*)$/)
          if (stepMatch) {
            return (
              <div key={i} className="flex gap-2.5 items-start">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
                  {stepMatch[1].replace(/[.)]/g, '')}
                </span>
                <p className="text-sm text-gray-800 leading-relaxed">{stepMatch[2]}</p>
              </div>
            )
          }
          return (
            <p key={i} className="text-sm text-gray-800 leading-relaxed">
              {line}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{answer}</p>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────────────────

export function SOPQueryModal({ isOpen, onClose }: SOPQueryModalProps) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SOPQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuestion('')
      setResult(null)
      setError(null)
      setLoading(false)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  async function handleAsk() {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await sopApi.query(q)
      setResult(res.data)
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to query SOP library. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  function handleCreateTasks() {
    alert('Tasks created!')
    onClose()
  }

  const hasSuggestedTasks = (result?.suggested_tasks?.length ?? 0) > 0
  const displaySources = result?.sources?.slice(0, 3) ?? []

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 pb-6 overflow-y-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ask AI about SOPs"
          className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Ask AI about SOPs</h2>
                <p className="text-xs text-gray-400 leading-tight mt-0.5">
                  Ask any question about your hotel's procedures
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          {/* Input area */}
          <div className="space-y-3">
            <textarea
              ref={textareaRef}
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="e.g. What is the checkout cleaning procedure for suites? (Press Enter to ask)"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400">
                Shift+Enter for new line · Enter to ask
              </p>
              <button
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Searching…
                  </>
                ) : (
                  'Ask AI'
                )}
              </button>
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <LoadingDots />
              <p className="text-xs text-gray-400 mt-1">
                Searching your SOP library…
              </p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && !loading && (
            <div className="mt-5 border-t border-gray-100 pt-5 space-y-5">
              {/* Answer */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Answer
                </h3>
                <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-4">
                  <AnswerBlock answer={result.answer} />
                </div>
              </div>

              {/* Sources */}
              {displaySources.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Sources
                  </h3>
                  <div className="space-y-2">
                    {displaySources.map((source, i) => (
                      <SourceCard key={`${source.document_id}-${i}`} source={source} index={i} />
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested tasks */}
              {hasSuggestedTasks && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Suggested Tasks
                    </h3>
                    <Lightbulb size={12} className="text-amber-500" />
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                    {result.suggested_tasks.map((task, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {task.title}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${taskTypeBadgeClass(task.task_type)}`}
                            >
                              {taskTypeLabel(task.task_type)}
                            </span>
                            <span
                              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full capitalize ${priorityBadgeClass(task.priority)}`}
                            >
                              {task.priority}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={handleCreateTasks}
                      className="px-4 py-2 text-sm font-medium text-brand-700 border border-brand-300 rounded-lg hover:bg-brand-50 transition-colors"
                    >
                      Create Tasks
                    </button>
                  </div>
                </div>
              )}

              {/* Token usage footer */}
              <p className="text-xs text-gray-300 text-right">
                {result.prompt_tokens + result.completion_tokens} tokens used
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
