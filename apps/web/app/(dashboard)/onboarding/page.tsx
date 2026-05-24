'use client'

import { useState, useCallback, useRef, forwardRef, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelsApi, type CreateHotelData } from '@/lib/api/hotels'
import { apiClient } from '@/lib/api/client'
import { Card } from '@/components/ui/Card'
import {
  Button as UIButton,
} from '@/components/ui/Button'
import {
  Building2,
  BedDouble,
  Users,
  Plug,
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Upload,
  Plus,
  Trash2,
  Loader2,
  SkipForward,
  AlertCircle,
  Bot,
  Check,
  X,
  PartyPopper,
  ArrowRight,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepStatus = 'pending' | 'active' | 'completed' | 'skipped'

interface StepMeta {
  id: number
  label: string
  icon: React.ReactNode
  optional?: boolean
}

const STEPS: StepMeta[] = [
  { id: 1, label: 'Hotel Profile', icon: <Building2 className="w-4 h-4" /> },
  { id: 2, label: 'Import Rooms', icon: <BedDouble className="w-4 h-4" /> },
  { id: 3, label: 'Invite Staff', icon: <Users className="w-4 h-4" /> },
  { id: 4, label: 'Opera Cloud', icon: <Plug className="w-4 h-4" />, optional: true },
  { id: 5, label: 'Upload SOPs', icon: <FileText className="w-4 h-4" />, optional: true },
  { id: 6, label: 'Done!', icon: <CheckCircle2 className="w-4 h-4" /> },
]

// ---------------------------------------------------------------------------
// Zod schema – Step 1
// ---------------------------------------------------------------------------

const hotelSchema = z.object({
  name: z.string().min(2, 'Hotel name is required'),
  address: z.string().min(3, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().length(2, 'Enter 2-letter state code'),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  phone: z.string().regex(/^\+?[\d\s\-().]{7,}$/, 'Enter a valid phone number'),
  room_count: z
    .number({ invalid_type_error: 'Room count is required' })
    .int()
    .min(1, 'Must have at least 1 room')
    .max(1000, 'Max 1000 rooms'),
  timezone: z.enum([
    'America/Chicago',
    'America/New_York',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
  ]),
})

type HotelFormValues = z.infer<typeof hotelSchema>

// ---------------------------------------------------------------------------
// Staff invite row type
// ---------------------------------------------------------------------------

type StaffRole =
  | 'gm'
  | 'housekeeping_supervisor'
  | 'housekeeper'
  | 'chief_engineer'
  | 'engineer'
  | 'front_desk'

const ROLE_LABELS: Record<StaffRole, string> = {
  gm: 'GM',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  housekeeper: 'Housekeeper',
  chief_engineer: 'Chief Engineer',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

interface InviteRow {
  id: string
  email: string
  full_name: string
  role: StaffRole
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-[var(--alert)] ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-[var(--alert)] flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400',
        'focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent',
        'disabled:bg-gray-50 disabled:text-gray-400',
        className
      )}
    />
  )
)
Input.displayName = 'Input'

const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      {...props}
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-surface',
        'focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent',
        'disabled:bg-gray-50 disabled:text-gray-400',
        className
      )}
    >
      {children}
    </select>
  )
)
Select.displayName = 'Select'

function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed'
  const variants = {
    primary:
      'bg-[var(--caution)] text-white hover:bg-amber-600 focus:ring-amber-400 shadow-sm',
    secondary:
      'bg-surface text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-amber-400 shadow-sm',
    ghost: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 focus:ring-gray-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  }
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// AI Assistant sidebar
// ---------------------------------------------------------------------------

interface AISidebarProps {
  tip: string
  currentStep: number
  hotelName: string
  completedStepIds: string[]
}

interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
  tip?: string | null
}

function AISidebar({ tip, currentStep, hotelName, completedStepIds }: AISidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = useCallback(async () => {
    const userMessage = input.trim()
    if (!userMessage || isLoading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const res = await apiClient.post('/onboarding/ai-assistant', {
        message: userMessage,
        context: {
          current_step: currentStep,
          hotel_name: hotelName || '',
          completed_steps: completedStepIds,
        },
      })
      const data = res.data
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data?.message || 'Happy to help! What else would you like to know?',
          tip: data?.tip ?? null,
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I ran into an issue. Please try again in a moment.',
          tip: null,
        },
      ])
    } finally {
      setIsLoading(false)
      setTimeout(scrollToBottom, 50)
    }
  }, [input, isLoading, currentStep, hotelName, completedStepIds])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <aside className="w-full h-full flex flex-col bg-[var(--caution-soft)] border-l border-amber-100 rounded-r-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-[var(--caution)] flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-amber-900 text-sm">AI Assistant</span>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 mb-3" aria-live="polite">
        {/* Initial greeting bubble */}
        <div className="bg-surface rounded-xl p-4 shadow-sm border border-amber-100">
          <p className="text-sm text-gray-700 leading-relaxed">
            Hi! I'm here to help you get set up quickly. Ask me anything about this step.
          </p>
        </div>

        {/* Static tip from AI_TIPS while no conversation */}
        {messages.length === 0 && (
          <div className="bg-[var(--caution)] rounded-xl p-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-75 mb-1">
              Tip
            </p>
            <p className="text-sm leading-relaxed">{tip}</p>
          </div>
        )}

        {/* Conversation messages */}
        {messages.map((msg, idx) => (
          <div key={idx}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="bg-[var(--caution)] text-white rounded-xl px-4 py-2.5 text-sm max-w-[90%]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-xl p-4 shadow-sm border border-amber-100">
                <p className="text-sm text-gray-700 leading-relaxed">{msg.content}</p>
                {msg.tip && (
                  <p className="text-xs text-[var(--caution)] mt-2 italic">{msg.tip}</p>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="bg-surface rounded-xl p-4 shadow-sm border border-amber-100">
            <div className="flex items-center gap-2 text-amber-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Ask a question"
          placeholder="Ask a question..."
          disabled={isLoading}
          className={cn(
            'flex-1 min-w-0 rounded-lg border border-[var(--caution-line)] bg-surface px-3 py-2 text-sm text-gray-900 placeholder-stone-400',
            'focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent',
            'disabled:opacity-60'
          )}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className={cn(
            'shrink-0 w-8 h-8 rounded-lg bg-[var(--caution)] text-white flex items-center justify-center',
            'hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          aria-label="Send"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="mt-3">
        <p className="text-xs text-amber-400 text-center">
          Powered by GPT-4o-mini
        </p>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Progress bar / step indicators
// ---------------------------------------------------------------------------

function ProgressHeader({
  currentStep,
  stepStatuses,
}: {
  currentStep: number
  stepStatuses: Record<number, StepStatus>
}) {
  return (
    <div className="border-b border-amber-100/50 bg-surface/60 backdrop-blur-sm px-8 py-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--caution)] flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-gray-900">PatelRep Setup Wizard</span>
        </div>
        <span className="text-sm text-gray-500 font-medium">
          Step {currentStep} of {STEPS.length}
        </span>
      </div>

      {/* Step dots + labels */}
      <div className="flex items-center gap-0">
        {STEPS.map((step, idx) => {
          const status = stepStatuses[step.id]
          const isCompleted = status === 'completed' || status === 'skipped'
          const isActive = status === 'active'
          const isSkipped = status === 'skipped'
          const isLast = idx === STEPS.length - 1

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
                    isCompleted && !isSkipped &&
                      'bg-green-400 text-white',
                    isSkipped &&
                      'bg-green-400 text-white',
                    isActive &&
                      'bg-amber-400 text-white shadow-md',
                    !isCompleted && !isActive &&
                      'bg-surface/60 text-slate-400 border border-[var(--caution-line)]/[0.40]'
                  )}
                >
                  {isCompleted && !isSkipped ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-xs font-bold">{step.id}</span>
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap',
                    isActive ? 'text-[var(--caution)]' : isCompleted ? 'text-gray-600' : 'text-gray-400'
                  )}
                >
                  {step.label}
                  {step.optional && (
                    <span className="ml-1 text-gray-400 font-normal">(opt)</span>
                  )}
                </span>
              </div>
              {!isLast && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-2 mt-[-14px] rounded transition-all duration-300',
                    isCompleted ? 'bg-amber-400' : 'bg-gray-200'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Hotel Profile
// ---------------------------------------------------------------------------

function Step1HotelProfile({
  onComplete,
}: {
  onComplete: (hotel: any, subscription: any) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<HotelFormValues>({
    resolver: zodResolver(hotelSchema),
    defaultValues: {
      state: 'TX',
      timezone: 'America/Chicago',
    },
  })

  const onSubmit = async (values: HotelFormValues) => {
    try {
      const payload: CreateHotelData = {
        name: values.name,
        address: values.address,
        city: values.city,
        state: values.state,
        zip: values.zip,
        phone: values.phone,
        room_count: values.room_count,
        timezone: values.timezone,
      }
      const res = await hotelsApi.create(payload)
      onComplete(res.data.hotel, res.data.subscription)
    } catch (err: any) {
      setError('root', {
        message: err.message || 'Failed to create hotel. Please try again.',
      })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Hotel Profile</h2>
        <p className="text-sm text-gray-500 mt-1">
          Tell us about your property. This creates your hotel in PatelRep.
        </p>
      </div>

      {errors.root && (
        <div className="flex items-start gap-2 rounded-lg bg-[var(--alert-soft)] border border-red-200 p-3">
          <AlertCircle className="w-4 h-4 text-[var(--alert)] shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{errors.root.message}</p>
        </div>
      )}

      <FormField label="Hotel Name" required error={errors.name?.message}>
        <Input
          {...register('name')}
          placeholder="Lakeside Inn & Suites"
          autoFocus
        />
      </FormField>

      <FormField label="Address" required error={errors.address?.message}>
        <Input {...register('address')} placeholder="1234 Main Street" />
      </FormField>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <FormField label="City" required error={errors.city?.message}>
            <Input {...register('city')} placeholder="Austin" />
          </FormField>
        </div>
        <div className="col-span-1">
          <FormField label="State" required error={errors.state?.message}>
            <Input
              {...register('state')}
              placeholder="TX"
              maxLength={2}
              className="uppercase"
            />
          </FormField>
        </div>
        <div className="col-span-1">
          <FormField label="ZIP Code" required error={errors.zip?.message}>
            <Input {...register('zip')} placeholder="78701" maxLength={10} />
          </FormField>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Phone" required error={errors.phone?.message}>
          <Input
            {...register('phone')}
            type="tel"
            placeholder="(512) 555-0100"
          />
        </FormField>
        <FormField label="Room Count" required error={errors.room_count?.message}>
          <Input
            {...register('room_count', { valueAsNumber: true })}
            type="number"
            placeholder="87"
            min={1}
            max={1000}
          />
        </FormField>
      </div>

      <FormField label="Timezone" required error={errors.timezone?.message}>
        <Select {...register('timezone')}>
          <option value="America/Chicago">America/Chicago (CT)</option>
          <option value="America/New_York">America/New_York (ET)</option>
          <option value="America/Denver">America/Denver (MT)</option>
          <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
          <option value="America/Phoenix">America/Phoenix (MST, no DST)</option>
        </Select>
      </FormField>

      <div className="pt-2">
        <UIButton type="submit" variant="primary" disabled={isSubmitting} className="w-full sm:w-auto">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Create Hotel & Continue
          <ChevronRight className="w-4 h-4" />
        </UIButton>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Import Rooms
// ---------------------------------------------------------------------------

type RoomsTab = 'csv' | 'manual'

interface ManualRoom {
  id: string
  room_number: string
  floor: string
}

function Step2ImportRooms({
  hotelId,
  onComplete,
  onSkip,
}: {
  hotelId: string
  onComplete: () => void
  onSkip: () => void
}) {
  const supabase = createClient()
  const [tab, setTab] = useState<RoomsTab>('csv')
  const [isDragging, setIsDragging] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    count?: number
    error?: string
    warnings?: string[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [manualRooms, setManualRooms] = useState<ManualRoom[]>([
    { id: uid(), room_number: '', floor: '' },
    { id: uid(), room_number: '', floor: '' },
    { id: uid(), room_number: '', floor: '' },
    { id: uid(), room_number: '', floor: '' },
    { id: uid(), room_number: '', floor: '' },
  ])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) {
      setCsvFile(file)
      setUploadResult(null)
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCsvFile(file)
      setUploadResult(null)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile) return
    setUploading(true)
    setUploadResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const formData = new FormData()
      formData.append('file', csvFile)
      formData.append('hotel_id', hotelId)

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1'}/onboarding/rooms/import-csv`,
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
        throw new Error(err.error?.message || 'Upload failed')
      }
      const json = await res.json()
      setUploadResult({ count: json.data?.imported_count || json.data?.count })
    } catch (err: any) {
      setUploadResult({ error: err.message || 'Upload failed. Please try again.' })
    } finally {
      setUploading(false)
    }
  }

  const updateManualRoom = (id: string, field: keyof Omit<ManualRoom, 'id'>, value: string) => {
    setManualRooms((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Import Rooms</h2>
        <p className="text-sm text-gray-500 mt-1">
          Add your room inventory to power the housekeeping board.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-gray-200 p-1 bg-gray-50 w-fit gap-1">
        {([
          { id: 'csv', label: 'CSV Upload' },
          { id: 'manual', label: 'Manual Entry' },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setUploadResult(null) }}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              tab === t.id
                ? 'bg-surface text-[var(--caution)] shadow-sm border border-gray-200'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'csv' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
              isDragging
                ? 'border-[var(--caution-line)] bg-[var(--caution-soft)]'
                : csvFile
                ? 'border-green-400 bg-[var(--ready-soft)]'
                : 'border-gray-300 bg-gray-50 hover:border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/30'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            {csvFile ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <p className="font-medium text-gray-800">{csvFile.name}</p>
                <p className="text-sm text-gray-500">
                  {(csvFile.size / 1024).toFixed(1)} KB — Click to replace
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-gray-400" />
                <p className="font-medium text-gray-700">
                  Drag & drop your CSV here
                </p>
                <p className="text-sm text-gray-400">or click to browse files</p>
              </div>
            )}
          </div>

          {/* Expected format */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
              Expected CSV format
            </p>
            <pre className="text-xs text-gray-500 font-mono leading-relaxed">
{`room_number,floor,room_type_code,room_type_name
101,1,STD,Standard King
102,1,STD,Standard Double
201,2,DLX,Deluxe King`}
            </pre>
          </div>

          {uploadResult && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3',
                uploadResult.error
                  ? 'bg-[var(--alert-soft)] border-red-200'
                  : 'bg-[var(--ready-soft)] border-green-200'
              )}
            >
              {uploadResult.error ? (
                <AlertCircle className="w-4 h-4 text-[var(--alert)] shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-[var(--ready)] shrink-0 mt-0.5" />
              )}
              <p className={cn('text-sm', uploadResult.error ? 'text-red-700' : 'text-green-700')}>
                {uploadResult.error ||
                  `Successfully imported ${uploadResult.count} room${uploadResult.count !== 1 ? 's' : ''}.`}
              </p>
            </div>
          )}

          {csvFile && !uploadResult?.count && (
            <Button
              onClick={handleCsvUpload}
              loading={uploading}
              disabled={uploading}
            >
              <Upload className="w-4 h-4" />
              Upload CSV
            </Button>
          )}

          {uploadResult?.count && (
            <Button onClick={onComplete}>
              Continue
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {tab === 'manual' && (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            <span>Room Number</span>
            <span>Floor</span>
            <span />
          </div>
          {manualRooms.map((room, idx) => (
            <div key={room.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <Input
                value={room.room_number}
                onChange={(e) => updateManualRoom(room.id, 'room_number', e.target.value)}
                placeholder={`e.g. ${100 + idx + 1}`}
              />
              <Input
                value={room.floor}
                onChange={(e) => updateManualRoom(room.id, 'floor', e.target.value)}
                placeholder={`e.g. ${idx + 1}`}
                type="number"
                min={1}
              />
              <button
                onClick={() =>
                  setManualRooms((prev) => prev.filter((r) => r.id !== room.id))
                }
                className="text-gray-300 hover:text-red-400 transition-colors p-1"
                title="Remove row"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setManualRooms((prev) => [
                ...prev,
                { id: uid(), room_number: '', floor: '' },
              ])
            }
            className="flex items-center gap-1.5 text-sm text-[var(--caution)] hover:text-amber-800 font-medium mt-1"
          >
            <Plus className="w-4 h-4" />
            Add row
          </button>
          <Button
            onClick={onComplete}
            disabled={manualRooms.every((r) => !r.room_number)}
          >
            Save Rooms & Continue
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      <button
        onClick={onSkip}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors mt-2"
      >
        <SkipForward className="w-3.5 h-3.5" />
        Skip for now — I'll add rooms in Settings
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Invite Staff
// ---------------------------------------------------------------------------

function Step3InviteStaff({
  hotelId,
  onComplete,
  onSkip,
}: {
  hotelId: string
  onComplete: (count: number) => void
  onSkip: () => void
}) {
  const [invites, setInvites] = useState<InviteRow[]>([
    { id: uid(), email: '', full_name: '', role: 'housekeeping_supervisor' },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    errors: string[]
  } | null>(null)

  const addRow = () => {
    setInvites((prev) => [
      ...prev,
      { id: uid(), email: '', full_name: '', role: 'housekeeper' },
    ])
  }

  const removeRow = (id: string) => {
    setInvites((prev) => prev.filter((r) => r.id !== id))
  }

  const updateRow = (id: string, field: keyof Omit<InviteRow, 'id'>, value: string) => {
    setInvites((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value as StaffRole } : r))
    )
  }

  const validInvites = invites.filter(
    (i) => i.email.trim() && i.full_name.trim() && i.role
  )

  const handleSubmit = async () => {
    if (validInvites.length === 0) return
    setSubmitting(true)
    const errors: string[] = []
    setProgress({ done: 0, total: validInvites.length, errors: [] })

    for (let i = 0; i < validInvites.length; i++) {
      const invite = validInvites[i]
      try {
        await apiClient.post('/staff/onboarding-invite', {
          email: invite.email.trim(),
          full_name: invite.full_name.trim(),
          role: invite.role,
          hotel_id: hotelId,
        })
      } catch (err: any) {
        errors.push(`${invite.email}: ${err.message || 'Failed'}`)
      }
      setProgress({ done: i + 1, total: validInvites.length, errors: [...errors] })
    }

    setSubmitting(false)
    const succeeded = validInvites.length - errors.length
    if (succeeded > 0) {
      setTimeout(() => onComplete(succeeded), 800)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Invite Staff</h2>
        <p className="text-sm text-gray-500 mt-1">
          Staff will receive a magic link to join your hotel workspace.
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
          <span>Full Name</span>
          <span>Email</span>
          <span>Role</span>
          <span />
        </div>
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2 items-center"
          >
            <Input
              value={invite.full_name}
              onChange={(e) => updateRow(invite.id, 'full_name', e.target.value)}
              placeholder="Maria Santos"
            />
            <Input
              type="email"
              value={invite.email}
              onChange={(e) => updateRow(invite.id, 'email', e.target.value)}
              placeholder="maria@hotel.com"
            />
            <Select
              value={invite.role}
              onChange={(e) => updateRow(invite.id, 'role', e.target.value)}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <button
              onClick={() => removeRow(invite.id)}
              disabled={invites.length === 1}
              className="text-gray-300 hover:text-red-400 disabled:opacity-30 transition-colors p-1"
              title="Remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="flex items-center gap-1.5 text-sm text-[var(--caution)] hover:text-amber-800 font-medium"
      >
        <Plus className="w-4 h-4" />
        Add another invite
      </button>

      {/* Progress feedback */}
      {progress && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              Sending invites… {progress.done}/{progress.total}
            </span>
            {progress.done === progress.total && (
              <span className="text-[var(--ready)] font-medium flex items-center gap-1">
                <Check className="w-4 h-4" /> Done
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-300"
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
              }}
            />
          </div>
          {progress.errors.length > 0 && (
            <ul className="space-y-1">
              {progress.errors.map((e, i) => (
                <li key={i} className="text-xs text-[var(--alert)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={handleSubmit}
          loading={submitting}
          disabled={validInvites.length === 0}
        >
          Send Invites ({validInvites.length})
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <button
        onClick={onSkip}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <SkipForward className="w-3.5 h-3.5" />
        Skip for now — I'll invite staff later
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Connect Opera Cloud
// ---------------------------------------------------------------------------

function Step4OperaCloud({
  onComplete,
  onSkip,
}: {
  onComplete: () => void
  onSkip: () => void
}) {
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    ohip_base_url: '',
    hotel_id_opera: '',
    integration_username: '',
    integration_password: '',
  })

  const setField =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
    }

  const canConnect =
    form.ohip_base_url.trim() !== '' && form.hotel_id_opera.trim() !== ''

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const res = await apiClient.post('/integrations/opera/connect', {
        ohip_base_url: form.ohip_base_url.trim(),
        hotel_id_opera: form.hotel_id_opera.trim(),
        integration_username: form.integration_username.trim() || undefined,
        integration_password: form.integration_password || undefined,
      })
      if (!res.data?.connected) throw new Error(res.data?.message || 'Connection could not be verified.')
      setConnected(true)
    } catch (err: any) {
      setError(err.message || 'Failed to connect Opera Cloud.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Connect Opera Cloud</h2>
        <p className="text-sm text-gray-500 mt-1">
          Optional — sync your PMS directly with PatelRep using your OHIP credentials.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Plug className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Oracle Opera Cloud PMS</p>
            <p className="text-sm text-gray-500">Industry-standard property management</p>
          </div>
        </div>

        <ul className="space-y-2">
          {[
            'Automatically update room status when guests check out',
            'Pull reservation data for predictive housekeeping',
            'Real-time webhooks + 30-minute polling fallback',
            'No manual data entry for occupancy or arrivals',
          ].map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm text-gray-700">
              <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
              {benefit}
            </li>
          ))}
        </ul>
      </div>

      {!connected && (
        <div className="rounded-xl border border-gray-200 bg-surface p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="onboarding-ohip-base-url" className="block text-sm font-medium text-gray-700 mb-1.5">
                OHIP Base URL <span className="text-[var(--alert)]">*</span>
              </label>
              <input
                id="onboarding-ohip-base-url"
                type="url"
                value={form.ohip_base_url}
                onChange={setField('ohip_base_url')}
                placeholder="https://hospitality.oracle.com"
                className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label htmlFor="onboarding-opera-hotel-code" className="block text-sm font-medium text-gray-700 mb-1.5">
                Opera Hotel Code <span className="text-[var(--alert)]">*</span>
              </label>
              <input
                id="onboarding-opera-hotel-code"
                type="text"
                value={form.hotel_id_opera}
                onChange={setField('hotel_id_opera')}
                placeholder="SAND01"
                className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label htmlFor="onboarding-opera-username" className="block text-sm font-medium text-gray-700 mb-1.5">
                Integration Username
              </label>
              <input
                id="onboarding-opera-username"
                type="text"
                value={form.integration_username}
                onChange={setField('integration_username')}
                placeholder="integration_user"
                autoComplete="username"
                className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label htmlFor="onboarding-opera-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Integration Password
              </label>
              <input
                id="onboarding-opera-password"
                type="password"
                value={form.integration_password}
                onChange={setField('integration_password')}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
        </div>
      )}

      {connected && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--ready-soft)] border border-green-200 p-3">
          <CheckCircle2 className="w-5 h-5 text-[var(--ready)] shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">
              Opera Cloud connected!
            </p>
            <p className="text-xs text-[var(--ready)]">
              PatelRep can now sync eligible room and reservation data.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-[var(--alert-soft)] border border-red-200 p-3">
          <AlertCircle className="w-4 h-4 text-[var(--alert)] shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {!connected ? (
          <Button onClick={handleConnect} loading={connecting} disabled={!canConnect || connecting} size="lg">
            <Plug className="w-4 h-4" />
            Connect Opera Cloud
          </Button>
        ) : (
          <Button onClick={onComplete} size="lg">
            Continue
            <ChevronRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      <button
        onClick={onSkip}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <SkipForward className="w-3.5 h-3.5" />
        Skip for now — Connect later in Settings › Integrations
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5 — Upload SOPs
// ---------------------------------------------------------------------------

interface UploadedDoc {
  name: string
  size: number
}

function Step5UploadSOPs({
  onComplete,
  onSkip,
}: {
  onComplete: (count: number) => void
  onSkip: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [queue, setQueue] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf')
    setQueue((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name))]
    })
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const removeQueued = (name: string) => {
    setQueue((prev) => prev.filter((f) => f.name !== name))
  }

  const handleUpload = async () => {
    if (queue.length === 0) return
    setUploading(true)
    setError(null)

    const newlyUploaded: UploadedDoc[] = []
    const errors: string[] = []

    for (const file of queue) {
      const formData = new FormData()
      formData.append('file', file)
      try {
        await apiClient.post('/sop/documents', formData)
        newlyUploaded.push({ name: file.name, size: file.size })
      } catch (err: any) {
        errors.push(`${file.name}: ${err.message}`)
      }
    }

    setUploaded((prev) => [...prev, ...newlyUploaded])
    setQueue([])
    setUploading(false)

    if (errors.length > 0) {
      setError(errors.join('\n'))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Upload SOPs</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload your Standard Operating Procedures to power the AI assistant.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
          isDragging
            ? 'border-[var(--caution-line)] bg-[var(--caution-soft)]'
            : 'border-gray-300 bg-gray-50 hover:border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/30'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-2">
          <FileText className="w-8 h-8 text-gray-400" />
          <p className="font-medium text-gray-700">Drag & drop PDF files here</p>
          <p className="text-sm text-gray-400">
            or click to browse — Housekeeping SOP, Safety Procedures, etc.
          </p>
        </div>
      </div>

      {/* Queued files */}
      {queue.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Ready to upload ({queue.length})
          </p>
          {queue.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-surface p-2.5"
            >
              <FileText className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
              <span className="text-xs text-gray-400 shrink-0">
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeQueued(f.name) }}
                className="text-gray-300 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Button onClick={handleUpload} loading={uploading} disabled={uploading}>
            <Upload className="w-4 h-4" />
            Upload {queue.length} Document{queue.length !== 1 ? 's' : ''}
          </Button>
        </div>
      )}

      {/* Uploaded */}
      {uploaded.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Uploaded ({uploaded.length})
          </p>
          {uploaded.map((doc) => (
            <div
              key={doc.name}
              className="flex items-center gap-3 rounded-lg border border-green-200 bg-[var(--ready-soft)] p-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span className="flex-1 text-sm text-gray-700 truncate">{doc.name}</span>
              <span className="text-xs text-gray-400 shrink-0">
                {(doc.size / 1024).toFixed(0)} KB
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-[var(--alert-soft)] border border-red-200 p-3">
          <p className="text-xs text-[var(--alert)] whitespace-pre-line">{error}</p>
        </div>
      )}

      {uploaded.length > 0 && queue.length === 0 && (
        <Button onClick={() => onComplete(uploaded.length)}>
          Continue
          <ChevronRight className="w-4 h-4" />
        </Button>
      )}

      <button
        onClick={onSkip}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <SkipForward className="w-3.5 h-3.5" />
        Skip for now — Upload SOPs later in Settings
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 6 — Done
// ---------------------------------------------------------------------------

function Step6Done({
  hotelName,
  roomsImported,
  staffInvited,
  operaConnected,
  sopCount,
  skippedSteps,
  onGoToDashboard,
}: {
  hotelName: string
  roomsImported: boolean
  staffInvited: number
  operaConnected: boolean
  sopCount: number
  skippedSteps: number[]
  onGoToDashboard: () => void
}) {
  const summaryItems = [
    {
      icon: <Building2 className="w-5 h-5" />,
      label: 'Hotel created',
      detail: hotelName,
      done: true,
    },
    {
      icon: <BedDouble className="w-5 h-5" />,
      label: 'Rooms imported',
      detail: roomsImported ? 'Done' : 'Skipped',
      done: roomsImported,
    },
    {
      icon: <Users className="w-5 h-5" />,
      label: 'Staff invited',
      detail: staffInvited > 0 ? `${staffInvited} invite${staffInvited !== 1 ? 's' : ''} sent` : 'Skipped',
      done: staffInvited > 0,
    },
    {
      icon: <Plug className="w-5 h-5" />,
      label: 'Opera Cloud',
      detail: operaConnected ? 'Connected' : 'Not connected',
      done: operaConnected,
      optional: true,
    },
    {
      icon: <FileText className="w-5 h-5" />,
      label: 'SOP Documents',
      detail: sopCount > 0 ? `${sopCount} uploaded` : 'Not uploaded',
      done: sopCount > 0,
      optional: true,
    },
  ]

  const skippedOptional = skippedSteps.filter((s) => [4, 5].includes(s))
  const todoLinks: { label: string; href: string }[] = []
  if (skippedSteps.includes(2)) todoLinks.push({ label: 'Import rooms', href: '/settings' })
  if (skippedSteps.includes(3)) todoLinks.push({ label: 'Invite staff', href: '/settings' })
  if (skippedOptional.includes(4)) todoLinks.push({ label: 'Connect Opera Cloud', href: '/settings/integrations' })
  if (skippedOptional.includes(5)) todoLinks.push({ label: 'Upload SOP documents', href: '/settings' })

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
          <PartyPopper className="w-8 h-8 text-[var(--caution)]" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">You're all set!</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
            {hotelName} is ready to go. Your team can start using PatelRep right away.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-2">
        {summaryItems.map((item) => (
          <div
            key={item.label}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 transition-all',
              item.done
                ? 'border-green-200 bg-[var(--ready-soft)]'
                : item.optional
                ? 'border-gray-200 bg-gray-50'
                : 'border-[var(--caution-line)] bg-[var(--caution-soft)]'
            )}
          >
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                item.done
                  ? 'bg-green-100 text-[var(--ready)]'
                  : item.optional
                  ? 'bg-gray-100 text-gray-400'
                  : 'bg-amber-100 text-[var(--caution)]'
              )}
            >
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{item.label}</p>
              <p className="text-xs text-gray-500">{item.detail}</p>
            </div>
            {item.done ? (
              <Check className="w-4 h-4 text-green-500 shrink-0" />
            ) : (
              <span className="text-xs text-gray-400 shrink-0">
                {item.optional ? 'Optional' : 'To-do'}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Remaining todos */}
      {todoLinks.length > 0 && (
        <div className="rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] p-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            Complete these when you're ready:
          </p>
          <ul className="space-y-1.5">
            {todoLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="flex items-center gap-1.5 text-sm text-[var(--caution)] hover:text-amber-900 font-medium"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <UIButton variant="primary" onClick={onGoToDashboard} className="w-full sm:w-auto">
        Go to Dashboard
        <ArrowRight className="w-4 h-4" />
      </UIButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI tips per step
// ---------------------------------------------------------------------------

const AI_TIPS: Record<number, string> = {
  1: 'Your room count determines your monthly price cap ($2.50/room/month). A 100-room hotel caps at $250/month — no surprise bills.',
  2: 'Import your room list to enable the housekeeping board and AI room predictions. You can always add or edit rooms later in Settings.',
  3: 'Invite your housekeeping supervisor first — they can manage daily assignments and approve task completions independently.',
  4: 'Opera Cloud sync automatically updates room status when guests check out, so housekeepers always have the most current assignment list.',
  5: 'Your SOPs power the AI assistant\'s answers. Upload your housekeeping, safety, and maintenance procedures for the best results.',
  6: 'You\'re ready to go! The AI dashboard will start learning your hotel\'s patterns within the first few days of use.',
}

// ---------------------------------------------------------------------------
// Main wizard page
// ---------------------------------------------------------------------------

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const { setHotel, setSubscription } = useHotelStore()

  const [currentStep, setCurrentStep] = useState(() => {
    const step = parseInt(searchParams.get('step') ?? '1', 10)
    return Number.isFinite(step) ? Math.min(Math.max(step, 1), STEPS.length) : 1
  })
  // When deep-linked to a specific step (e.g. "Add Rooms" → ?step=2), render
  // only the step content — no progress header, AI sidebar, or wizard nav.
  const standalone = searchParams.get('step') !== null
  const [hotelId, setHotelId] = useState<string>('')
  const [hotelName, setHotelName] = useState<string>('')

  // Track per-step completion state
  const [completionState, setCompletionState] = useState<{
    roomsImported: boolean
    staffInvited: number
    operaConnected: boolean
    sopCount: number
    skippedSteps: number[]
  }>({
    roomsImported: false,
    staffInvited: 0,
    operaConnected: false,
    sopCount: 0,
    skippedSteps: [],
  })

  const stepStatuses = Object.fromEntries(
    STEPS.map((s) => {
      let status: StepStatus
      if (s.id < currentStep) {
        status = completionState.skippedSteps.includes(s.id) ? 'skipped' : 'completed'
      } else if (s.id === currentStep) {
        status = 'active'
      } else {
        status = 'pending'
      }
      return [s.id, status]
    })
  ) as Record<number, StepStatus>

  // When deep-linking to a step (e.g. /onboarding?step=2 from "Add Rooms"),
  // the hotel already exists — load it from the session so Step2+ have a valid hotelId.
  useEffect(() => {
    if (currentStep <= 1) return
    supabase.auth.getUser().then(({ data: { user } }) => {
      const id: string | undefined =
        user?.app_metadata?.hotel_id ?? user?.user_metadata?.hotel_id
      if (id) setHotelId(id)
    })
  }, [currentStep, supabase])

  // Refresh session when reaching the Done step so the JWT hook injects hotel_id.
  // Without this the middleware sees no hotel_id in the token and redirects back here.
  useEffect(() => {
    if (currentStep === 6) {
      supabase.auth.refreshSession()
    }
  }, [currentStep, supabase])

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length))
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 1))

  const markSkipped = (step: number) => {
    setCompletionState((prev) => ({
      ...prev,
      skippedSteps: [...prev.skippedSteps, step],
    }))
    goNext()
  }

  // Step 1 complete
  const handleHotelCreated = async (hotel: any, subscription: any) => {
    setHotelId(hotel.id)
    setHotelName(hotel.name)
    setHotel({
      id: hotel.id,
      name: hotel.name,
      timezone: hotel.timezone,
      room_count: hotel.room_count,
      logo_url: hotel.logo_url,
    })
    if (subscription) setSubscription(subscription)
    // Set a routing cookie immediately so the middleware allows navigation away
    // from /onboarding. This is a hint only — actual auth is enforced by RLS/JWT.
    document.cookie = `pr_hotel_id=${hotel.id}; path=/; max-age=31536000; SameSite=Lax`
    // Also persist to user_metadata so the JWT hook can pick it up on next refresh.
    await supabase.auth.updateUser({ data: { hotel_id: hotel.id } })
    goNext()
  }

  // Step 2 complete
  const handleRoomsComplete = () => {
    setCompletionState((prev) => ({ ...prev, roomsImported: true }))
    if (standalone) {
      router.push('/housekeeping')
    } else {
      goNext()
    }
  }

  // Step 3 complete
  const handleStaffComplete = (count: number) => {
    setCompletionState((prev) => ({ ...prev, staffInvited: count }))
    goNext()
  }

  // Step 4 complete
  const handleOperaComplete = () => {
    setCompletionState((prev) => ({ ...prev, operaConnected: true }))
    goNext()
  }

  // Step 5 complete
  const handleSopComplete = (count: number) => {
    setCompletionState((prev) => ({ ...prev, sopCount: count }))
    goNext()
  }

  // Derive completed step IDs for AI assistant context
  const completedStepIds: string[] = [
    ...(hotelId ? ['hotel_profile'] : []),
    ...(completionState.roomsImported ? ['rooms_imported'] : []),
    ...(completionState.staffInvited > 0 ? ['staff_invited'] : []),
    ...(completionState.operaConnected ? ['opera_connected'] : []),
    ...(completionState.sopCount > 0 ? ['sop_uploaded'] : []),
  ]

  if (standalone) {
    return (
      <div className="min-h-full">
        <div className="max-w-3xl mx-auto">
          <div className="bg-surface/[0.88] backdrop-blur-2xl rounded-[var(--r-lg)] shadow-xl border border-white/[0.95] overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-amber-100/50">
              <UIButton variant="ghost" onClick={() => router.push('/housekeeping')} className="h-8 px-2 text-sm">
                <ChevronLeft className="w-4 h-4" />
                Back
              </UIButton>
              <h2 className="text-base font-semibold text-slate-800">Add Rooms</h2>
            </div>
            <div className="p-6">
              <Card className="p-6">
                <Step2ImportRooms
                  hotelId={hotelId}
                  onComplete={handleRoomsComplete}
                  onSkip={() => router.push('/housekeeping')}
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Glass wizard card */}
      <div className="max-w-5xl mx-auto">
        <div className="bg-surface/[0.88] backdrop-blur-2xl rounded-[var(--r-lg)] shadow-xl border border-white/[0.95] overflow-hidden">
          {/* Progress header */}
          <ProgressHeader currentStep={currentStep} stepStatuses={stepStatuses} />

          {/* Main content + AI sidebar */}
          <div className="flex min-h-[540px]">
            {/* Step content */}
            <div className="flex-1 p-6 min-w-0">
              <Card className="p-6 h-full">
                {currentStep === 1 && (
                  <Step1HotelProfile onComplete={handleHotelCreated} />
                )}
                {currentStep === 2 && (
                  <Step2ImportRooms
                    hotelId={hotelId}
                    onComplete={handleRoomsComplete}
                    onSkip={() => markSkipped(2)}
                  />
                )}
                {currentStep === 3 && (
                  <Step3InviteStaff
                    hotelId={hotelId}
                    onComplete={handleStaffComplete}
                    onSkip={() => markSkipped(3)}
                  />
                )}
                {currentStep === 4 && (
                  <Step4OperaCloud
                    onComplete={handleOperaComplete}
                    onSkip={() => markSkipped(4)}
                  />
                )}
                {currentStep === 5 && (
                  <Step5UploadSOPs
                    onComplete={handleSopComplete}
                    onSkip={() => markSkipped(5)}
                  />
                )}
                {currentStep === 6 && (
                  <Step6Done
                    hotelName={hotelName}
                    roomsImported={completionState.roomsImported}
                    staffInvited={completionState.staffInvited}
                    operaConnected={completionState.operaConnected}
                    sopCount={completionState.sopCount}
                    skippedSteps={completionState.skippedSteps}
                    onGoToDashboard={async () => {
                      await supabase.auth.refreshSession()
                      router.push('/dashboard')
                    }}
                  />
                )}
              </Card>
            </div>

            {/* AI Assistant sidebar */}
            <div className="w-72 shrink-0">
              <AISidebar
                tip={AI_TIPS[currentStep]}
                currentStep={currentStep}
                hotelName={hotelName}
                completedStepIds={completedStepIds}
              />
            </div>
          </div>

          {/* Bottom navigation (steps 2–5 that don't have their own nav) */}
          {currentStep > 1 && currentStep < 6 && (
            <div className="flex items-center justify-between border-t border-amber-100/50 px-8 py-4 bg-surface/40 backdrop-blur-sm rounded-b-2xl">
              <UIButton variant="ghost" onClick={goBack}>
                <ChevronLeft className="w-4 h-4" />
                Back
              </UIButton>
              <span className="text-xs text-slate-400">
                {STEPS[currentStep - 1]?.optional ? 'This step is optional' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingPageInner />
    </Suspense>
  )
}
