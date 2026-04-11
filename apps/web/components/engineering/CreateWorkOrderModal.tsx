'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Sparkles, ClipboardList } from 'lucide-react'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreate: (wo: WorkOrder) => void
}

const CATEGORIES = [
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'structural', label: 'Structural' },
  { value: 'safety', label: 'Safety' },
  { value: 'general', label: 'General' },
]

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', desc: 'Safety issue or guest impact — immediate' },
  { value: 'normal', label: 'Normal', desc: 'Standard maintenance' },
  { value: 'low', label: 'Low', desc: 'Non-urgent, schedule when available' },
]

export function CreateWorkOrderModal({ isOpen, onClose, onCreate }: Props) {
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('general')
  const [priority, setPriority] = useState<string>('normal')
  const [locationText, setLocationText] = useState('')
  const [description, setDescription] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [nlInput, setNlInput] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reset form on open/close
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setCategory('general')
      setPriority('normal')
      setLocationText('')
      setDescription('')
      setUseAI(false)
      setNlInput('')
      setValidationError(null)
    }
  }, [isOpen])

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof engineeringApi.createWorkOrder>[0] = {
        category,
        priority,
        location_text: locationText.trim() || undefined,
        description: description.trim() || undefined,
      }
      if (useAI) {
        payload.nl_input = nlInput.trim()
      } else {
        payload.title = title.trim()
      }
      return engineeringApi.createWorkOrder(payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      onCreate(res.data)
    },
    onError: () => {
      setValidationError('Failed to create work order. Please try again.')
    },
  })

  function handleSubmit() {
    setValidationError(null)

    if (!useAI && !title.trim()) {
      setValidationError('Title is required.')
      return
    }
    if (useAI && !nlInput.trim()) {
      setValidationError('Please describe the issue for AI to process.')
      return
    }
    if (!locationText.trim()) {
      setValidationError('Location is required.')
      return
    }

    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create Work Order"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <ClipboardList className="w-5 h-5 text-amber-600 shrink-0" />
              <h2 className="text-base font-bold text-gray-900">New Work Order</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

            {/* AI toggle */}
            <div className="flex items-center justify-between p-3 bg-violet-50 border border-violet-200 rounded-xl">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-violet-900">Use AI to create</p>
                  <p className="text-xs text-violet-600">Describe the issue in plain language</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={useAI}
                onClick={() => setUseAI((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  useAI ? 'bg-violet-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    useAI ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Location — required, shown first */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Location <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="e.g. Room 214 or Lobby restroom"
              />
            </div>

            {/* Title (only when AI is off) */}
            {!useAI && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Title <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. A/C not cooling in Room 214"
                />
              </div>
            )}

            {/* NL Input (only when AI is on) */}
            {useAI && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Describe the issue <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  rows={3}
                  placeholder="e.g. The toilet in room 214 is leaking from the base and the guest is complaining..."
                  className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  AI will generate the title and categorize automatically.
                </p>
              </div>
            )}

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <div className="space-y-2">
                {PRIORITIES.map((p) => (
                  <label
                    key={p.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      priority === p.value
                        ? p.value === 'urgent'
                          ? 'border-red-300 bg-red-50'
                          : p.value === 'normal'
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-300 bg-slate-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p.value}
                      checked={priority === p.value}
                      onChange={() => setPriority(p.value)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 capitalize">{p.label}</p>
                      <p className="text-xs text-gray-500">{p.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            {!useAI && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Additional details about the issue…"
                  className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors resize-none"
                />
              </div>
            )}

            {/* Validation / API error */}
            {validationError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {validationError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/60 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {useAI ? 'Processing…' : 'Creating…'}
                </>
              ) : (
                useAI ? 'Create with AI' : 'Create Work Order'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
