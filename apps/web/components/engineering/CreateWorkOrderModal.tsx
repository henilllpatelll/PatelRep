'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Sparkles, ClipboardList } from 'lucide-react'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'

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

    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
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
          className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-2.5">
              <ClipboardList className="w-5 h-5 text-brand-600 shrink-0" />
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

            {/* Title (only when AI is off) */}
            {!useAI && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. A/C not cooling in Room 214"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
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
                          ? 'border-yellow-300 bg-yellow-50'
                          : 'border-gray-300 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p.value}
                      checked={priority === p.value}
                      onChange={() => setPriority(p.value)}
                      className="mt-0.5 accent-brand-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 capitalize">{p.label}</p>
                      <p className="text-xs text-gray-500">{p.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Location <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="e.g. Room 214 or Lobby restroom"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
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
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 border border-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {useAI ? 'Processing…' : 'Creating…'}
                </>
              ) : (
                useAI ? 'Create with AI' : 'Create Work Order'
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
