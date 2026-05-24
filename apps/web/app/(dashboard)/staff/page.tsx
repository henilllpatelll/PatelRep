'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserPlus,
  X,
  Search,
  ChevronDown,
  Mail,
  AlertTriangle,
  RefreshCw,
  Pencil,
  UserX,
  Clock,
  Calendar,
  Plus,
  Trash2,
} from 'lucide-react'
import { staffApi, type StaffMember, type StaffInvitation, type RoleSchedule, type CustomRole } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import type { UserRole } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Pill, SectionLabel } from '@/components/ui/primitives'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'gm', label: 'General Manager' },
  { value: 'housekeeping_supervisor', label: 'Housekeeping Supervisor' },
  { value: 'housekeeper', label: 'Housekeeper' },
  { value: 'chief_engineer', label: 'Chief Engineer' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'front_desk', label: 'Front Desk' },
]

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

const ROLE_TONE: Record<UserRole, 'caution' | 'ready' | 'neutral' | 'ai'> = {
  gm: 'caution',
  housekeeping_supervisor: 'ready',
  housekeeper: 'neutral',
  chief_engineer: 'ai',
  engineer: 'neutral',
  front_desk: 'ai',
}

const ROLE_AVATAR_COLORS: Record<UserRole, string> = {
  gm: 'bg-violet-600',
  housekeeping_supervisor: 'bg-green-600',
  housekeeper: 'bg-teal-600',
  chief_engineer: 'bg-blue-600',
  engineer: 'bg-sky-600',
  front_desk: 'bg-amber-600',
}

// â”€â”€â”€ Invite form schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const inviteSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['gm', 'housekeeping_supervisor', 'housekeeper', 'chief_engineer', 'engineer', 'front_desk'], {
    errorMap: () => ({ message: 'Select a role' }),
  }),
  department_id: z.string().optional(),
})

type InviteFormValues = z.infer<typeof inviteSchema>

const directSchema = inviteSchema.extend({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type DirectFormValues = z.infer<typeof directSchema>

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  return 'just now'
}

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RoleBadge({ role }: { role: UserRole }) {
  return <Pill tone={ROLE_TONE[role]}>{ROLE_LABELS[role]}</Pill>
}

function Avatar({ name, role }: { name: string; role: UserRole }) {
  return (
    <div
      className={`w-8 h-8 rounded-full ${ROLE_AVATAR_COLORS[role]} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
    >
      {getInitials(name)}
    </div>
  )
}

// â”€â”€â”€ Confirm Deactivate Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ConfirmDeactivateDialog({
  staff,
  onConfirm,
  onCancel,
  loading,
}: {
  staff: StaffMember
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(dialogRef, true, onCancel)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="deactivate-staff-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--alert-soft)] flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-[var(--alert)]" />
          </div>
          <div>
            <h3 id="deactivate-staff-title" className="text-base font-semibold text-gray-900">Deactivate Staff Member</h3>
            <p className="text-sm text-gray-500">This will revoke their access immediately.</p>
          </div>
        </div>

        <p className="text-sm text-gray-700">
          Are you sure you want to deactivate{' '}
          <span className="font-medium">{staff.full_name}</span>? They will lose access to PatelRep.
        </p>

        <div className="flex gap-3 pt-1">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={loading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Deactivatingâ€¦' : 'Deactivate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ Add Direct Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AddDirectModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const successDialogRef = useRef<HTMLDivElement>(null)
  const addDialogRef = useRef<HTMLDivElement>(null)
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string; name: string } | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting }, setError } = useForm<DirectFormValues>({
    resolver: zodResolver(directSchema),
    defaultValues: { role: 'housekeeper' },
  })

  const mutation = useMutation({
    mutationFn: (data: DirectFormValues) =>
      staffApi.addDirect({ full_name: data.full_name, email: data.email, role: data.role, department_id: data.department_id, password: data.password }),
    onSuccess: (res, data) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setCreatedCredentials({ email: data.email, password: data.password, name: data.full_name })
    },
    onError: (err: any) => setError('root', { message: err.message || 'Failed to add staff member.' }),
  })
  useModalFocusTrap(successDialogRef, !!createdCredentials, onClose)
  useModalFocusTrap(addDialogRef, !createdCredentials, onClose)

  if (createdCredentials) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
        <div ref={successDialogRef} role="dialog" aria-modal="true" aria-labelledby="staff-added-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
            <h2 id="staff-added-title" className="text-lg font-semibold text-gray-900">Staff Member Added</h2>
            <button onClick={onClose} aria-label="Close" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-surface/60 transition-colors"><X size={18} /></button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-600"><span className="font-medium">{createdCredentials.name}</span> has been added. Share these login credentials with them:</p>
            <div className="bg-[var(--caution-soft)] border border-[var(--caution-line)] rounded-xl p-4 space-y-2 font-mono text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Email</span><span className="font-medium text-gray-900">{createdCredentials.email}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Password</span><span className="font-medium text-gray-900">{createdCredentials.password}</span></div>
            </div>
            <p className="text-xs text-gray-400">They can change their password after logging in.</p>
            <Button variant="primary" onClick={() => { onSuccess(); onClose() }} className="w-full justify-center">Done</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={addDialogRef} role="dialog" aria-modal="true" aria-labelledby="add-staff-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 id="add-staff-title" className="text-lg font-semibold text-gray-900">Add Staff Manually</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-surface/60 transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="px-6 py-5 space-y-4">
          <p className="text-xs text-gray-500">Creates an account immediately â€” no email sent. You set the initial password to share with the staff member.</p>
          {errors.root && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg text-sm text-[var(--alert)]">
              <AlertTriangle size={15} className="shrink-0" />{errors.root.message}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input {...register('full_name')} placeholder="Maria Garcia" className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${errors.full_name ? 'border-red-300' : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'}`} />
            {errors.full_name && <p className="text-xs text-[var(--alert)]">{errors.full_name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Email Address</label>
            <input {...register('email')} type="email" placeholder="maria@sunriseinn.com" className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${errors.email ? 'border-red-300' : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'}`} />
            {errors.email && <p className="text-xs text-[var(--alert)]">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input {...register('password')} type="password" placeholder="Min. 8 characters" className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${errors.password ? 'border-red-300' : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'}`} />
            {errors.password && <p className="text-xs text-[var(--alert)]">{errors.password.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select {...register('role')} className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50">
              {ROLE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting} className="flex-1">Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting} className="flex-1">
              <UserPlus size={15} />{isSubmitting ? 'Addingâ€¦' : 'Add Staff'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Invite Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function InviteModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'housekeeper' },
  })

  const inviteMutation = useMutation({
    mutationFn: (data: InviteFormValues) =>
      staffApi.invite({
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        department_id: data.department_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] })
      onSuccess()
    },
    onError: (err: any) => {
      setError('root', {
        message: err.message || 'Failed to send invitation. Please try again.',
      })
    },
  })

  const onSubmit = (data: InviteFormValues) => inviteMutation.mutate(data)
  useModalFocusTrap(dialogRef, true, onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 id="modal-title" className="text-lg font-semibold text-gray-900">Invite Staff Member</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-surface/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {errors.root && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg text-sm text-[var(--alert)]">
              <AlertTriangle size={15} className="shrink-0" />
              {errors.root.message}
            </div>
          )}

          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input
              {...register('full_name')}
              placeholder="Maria Garcia"
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors ${
                errors.full_name
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'
              }`}
            />
            {errors.full_name && (
              <p className="text-xs text-[var(--alert)]">{errors.full_name.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Email Address</label>
            <input
              {...register('email')}
              type="email"
              placeholder="maria@sunriseinn.com"
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors ${
                errors.email
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'
              }`}
            />
            {errors.email && (
              <p className="text-xs text-[var(--alert)]">{errors.email.message}</p>
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              {...register('role')}
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors ${
                errors.role
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-[var(--caution-line)]/40 hover:border-[var(--caution-line)]'
              }`}
            >
              {ROLE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="text-xs text-[var(--alert)]">{errors.role.message}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
              className="flex-1"
            >
              <Mail size={15} />
              {isSubmitting ? 'Sendingâ€¦' : 'Send Invite'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Schedule helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SCHEDULE_OVERRIDE: Partial<Record<UserRole, 'housekeeping_supervisor' | 'chief_engineer'>> = {
  housekeeper: 'housekeeping_supervisor',
  engineer: 'chief_engineer',
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function formatScheduleDays(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' Â· ')
}

// â”€â”€â”€ Edit Staff Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EditStaffModal({
  staff,
  onClose,
  onSuccess,
}: {
  staff: StaffMember
  onClose: () => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [role, setRole] = useState<UserRole>(staff.role)
  const [customRoleId, setCustomRoleId] = useState<string | null>(staff.custom_role_id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDays, setSelectedDays] = useState<number[]>([])

  const overrideRole = SCHEDULE_OVERRIDE[staff.role]

  const schedulesQuery = useQuery({
    queryKey: ['role-schedules', staff.user_id],
    queryFn: () => staffApi.getRoleSchedules(staff.user_id),
    enabled: !!overrideRole,
    select: (res) => res.data,
  })

  const customRolesQuery = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => staffApi.listCustomRoles(),
    select: (res) => res.data,
  })

  const updateMutation = useMutation({
    mutationFn: () => staffApi.update(staff.user_id, { role, custom_role_id: customRoleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      onSuccess()
    },
    onError: (err: any) => setError(err.message || 'Failed to update staff member.'),
  })

  const createScheduleMutation = useMutation({
    mutationFn: () =>
      staffApi.createRoleSchedule(staff.user_id, {
        override_role: overrideRole!,
        days_of_week: selectedDays,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-schedules', staff.user_id] })
      setSelectedDays([])
    },
    onError: (err: any) => setError(err.message || 'Failed to create schedule.'),
  })

  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => staffApi.deleteRoleSchedule(staff.user_id, scheduleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['role-schedules', staff.user_id] }),
    onError: (err: any) => setError(err.message || 'Failed to remove schedule.'),
  })

  const toggleDay = (day: number) =>
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  useModalFocusTrap(dialogRef, true, onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-staff-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md overflow-y-auto max-h-[90vh]">

        {/* Sticky header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60 sticky top-0 bg-surface/80 backdrop-blur-xl z-10">
          <h2 id="edit-staff-title" className="text-lg font-semibold text-gray-900">Edit Staff Member</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-surface/60 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <Avatar name={staff.full_name} role={staff.role} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{staff.full_name}</p>
              <p className="text-xs text-gray-500 truncate">{staff.email}</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg text-sm text-[var(--alert)]">
              <AlertTriangle size={15} className="shrink-0" />{error}
            </div>
          )}

          {/* Base role */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            >
              {ROLE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Custom Role */}
          {(customRolesQuery.data ?? []).length > 0 && (
            <div className="space-y-1.5 border-t border-white/60 pt-4">
              <label className="block text-sm font-medium text-gray-700">Custom Role</label>
              <p className="text-xs text-gray-500">Override this staff member's sidebar with a custom permission set.</p>
              <select
                value={customRoleId ?? ''}
                onChange={(e) => setCustomRoleId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              >
                <option value="">â€” None (use base role) â€”</option>
                {(customRolesQuery.data ?? []).map((cr: CustomRole) => (
                  <option key={cr.id} value={cr.id}>{cr.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Role Schedule â€” only for housekeeper / engineer */}
          {overrideRole && (
            <div className="space-y-3 border-t border-white/60 pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Calendar size={14} className="text-[var(--caution)]" />
                Role Schedule
              </div>
              <p className="text-xs text-gray-500">
                On scheduled days,{' '}
                <span className="font-medium">{staff.full_name.split(' ')[0]}</span> acts as{' '}
                <span className="font-medium">{ROLE_LABELS[overrideRole]}</span> â€” full dashboard
                and feature access for that role.
              </p>

              {/* Existing schedules */}
              {schedulesQuery.isLoading ? (
                <p className="text-xs text-gray-400">Loadingâ€¦</p>
              ) : (schedulesQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-gray-400 italic">No schedule overrides set.</p>
              ) : (
                <div className="space-y-1.5">
                  {(schedulesQuery.data ?? []).map((s: RoleSchedule) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between px-3 py-2 bg-[var(--caution-soft)]/70 border border-amber-100 rounded-lg"
                    >
                      <span className="text-xs font-medium text-gray-800">
                        {formatScheduleDays(s.days_of_week)}
                        <span className="text-gray-400 font-normal ml-2">
                          â†’ {ROLE_LABELS[overrideRole]}
                        </span>
                      </span>
                      <button
                        onClick={() => deleteScheduleMutation.mutate(s.id)}
                        disabled={deleteScheduleMutation.isPending}
                        className="p-1 text-gray-400 hover:text-[var(--alert)] rounded transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Day picker */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-gray-600">Select days to add:</p>
                <div className="flex gap-1.5">
                  {DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full text-xs font-semibold transition-colors ${
                        selectedDays.includes(idx)
                          ? 'bg-amber-400 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => createScheduleMutation.mutate()}
                  disabled={selectedDays.length === 0 || createScheduleMutation.isPending}
                  className="text-xs h-8"
                >
                  <Plus size={13} />
                  {createScheduleMutation.isPending ? 'Addingâ€¦' : 'Add Schedule'}
                </Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-white/60">
            <Button variant="ghost" onClick={onClose} disabled={updateMutation.isPending} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || (role === staff.role && customRoleId === (staff.custom_role_id ?? null))}
              className="flex-1"
            >
              {updateMutation.isPending ? 'Savingâ€¦' : 'Save Role'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ Staff Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function StaffPage() {
  const { canManageStaff, isGM } = useRole()
  const queryClient = useQueryClient()

  // â”€â”€ All hooks must be called unconditionally before any early returns â”€â”€â”€â”€â”€â”€â”€

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showAddDirectModal, setShowAddDirectModal] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState<StaffMember | null>(null)
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // Auto-dismiss invite success banner
  useEffect(() => {
    if (!inviteSuccess) return
    const t = setTimeout(() => setInviteSuccess(false), 4000)
    return () => clearTimeout(t)
  }, [inviteSuccess])

  // â”€â”€ Data fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const staffQuery = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
    select: (res) => res.data.staff,
    enabled: isGM,
  })

  const invitationsQuery = useQuery({
    queryKey: ['staff-invitations'],
    queryFn: () => staffApi.listInvitations(),
    select: (res) => res.data.invitations,
    enabled: isGM,
  })

  // â”€â”€ Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const deactivateMutation = useMutation({
    mutationFn: (staffId: string) => staffApi.deactivate(staffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setConfirmDeactivate(null)
    },
  })

  const resendMutation = useMutation({
    mutationFn: (invitationId: string) => staffApi.resendInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] })
    },
  })

  // â”€â”€ Filtering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const filteredStaff = useMemo(() => {
    const staff = staffQuery.data ?? []
    return staff.filter((member) => {
      if (roleFilter !== 'all' && member.role !== roleFilter) return false
      if (statusFilter !== 'all' && member.status !== statusFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          member.full_name.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [staffQuery.data, roleFilter, statusFilter, searchQuery])

  const invitations = invitationsQuery.data ?? []

  // â”€â”€ Guard: non-GM sees access restricted â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (!isGM) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-700">Access restricted</p>
        <p className="text-xs text-gray-400 mt-1">Staff management is only available to managers.</p>
      </div>
    )
  }

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3 mb-1">Organization</p>
          <h1 className="text-2xl font-display font-normal text-ink tracking-tight">Staff</h1>
          <p className="text-[13px] text-ink-3 mt-0.5">
            {staffQuery.data?.length ?? 0} team member{staffQuery.data?.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManageStaff && (
          <>
          <div className="relative sm:hidden">
            <Button
              variant="primary"
              onClick={() => setAddMenuOpen((open) => !open)}
              className="w-full"
              aria-expanded={addMenuOpen}
              aria-haspopup="menu"
            >
              <UserPlus size={16} />
              Add Staff
              <ChevronDown size={14} className={`ml-auto transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} />
            </Button>
            {addMenuOpen && (
              <div className="absolute right-0 z-20 mt-2 w-full rounded-xl border border-line bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => { setAddMenuOpen(false); setShowInviteModal(true) }}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink-2 hover:bg-surface-2"
                  role="menuitem"
                >
                  <Mail size={16} />
                  Invite by Email
                </button>
                <button
                  type="button"
                  onClick={() => { setAddMenuOpen(false); setShowAddDirectModal(true) }}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink-2 hover:bg-surface-3"
                  role="menuitem"
                >
                  <UserPlus size={16} />
                  Add Manually
                </button>
              </div>
            )}
          </div>
          <div className="hidden gap-2 sm:flex">
            <Button variant="ghost" onClick={() => setShowAddDirectModal(true)}>
              <UserPlus size={16} />
              Add Manually
            </Button>
            <Button variant="primary" onClick={() => setShowInviteModal(true)}>
              <Mail size={16} />
              Invite
            </Button>
          </div>
          </>
        )}
      </div>

      {/* Invite success banner */}
      {inviteSuccess && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg text-sm text-green-800 font-medium">
          Invitation sent successfully.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Role filter */}
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
            className="appearance-none pl-3 pr-8 py-2 text-sm border border-line rounded-lg bg-surface hover:border-[var(--caution-line)] focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
          >
            <option value="all">All Roles</option>
            {ROLE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')
            }
            className="appearance-none pl-3 pr-8 py-2 text-sm border border-line rounded-lg bg-surface hover:border-[var(--caution-line)] focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or emailâ€¦"
            className="pl-9 pr-4 py-2 text-sm border border-line rounded-lg bg-surface w-64 focus:outline-none focus:ring-2 focus:ring-amber-400 hover:border-[var(--caution-line)] transition-colors"
          />
        </div>
      </div>

      {/* Staff table */}
      <SectionLabel hint={filteredStaff.length > 0 ? String(filteredStaff.length) : undefined}>Team Members</SectionLabel>
      <Card className="overflow-hidden p-0">
        {staffQuery.isLoading ? (
          <div className="px-6 py-12 text-center text-[13px] text-ink-3">Loading staff&hellip;</div>
        ) : staffQuery.isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] text-[var(--alert)] font-medium">Failed to load staff.</p>
            <button onClick={() => staffQuery.refetch()} className="mt-2 text-[13px] text-accent hover:underline">Try again</button>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="px-6 py-12 text-center text-[13px] text-ink-3">
            {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
              ? 'No staff match the current filters.'
              : 'No staff members yet. Invite your first team member above.'}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">Person</th>
                <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">Role</th>
                <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">Status</th>
                {canManageStaff && (
                  <th className="text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {filteredStaff.map((member) => (
                <tr key={member.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.full_name} role={member.role} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink truncate">{member.full_name}</p>
                        <p className="text-[11px] text-ink-3 truncate">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RoleBadge role={member.role} />
                      {member.custom_role_name && (
                        <Pill tone="ai">{member.custom_role_name}</Pill>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${member.status === 'active' ? 'text-[var(--ready)]' : 'text-ink-4'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${member.status === 'active' ? 'bg-[var(--ready)]' : 'bg-ink-4'}`} />
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManageStaff && (
                    <td className="px-6 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setEditStaff(member)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 bg-surface-2 border border-line rounded-[var(--r-sm)] hover:bg-surface-3 transition-colors">
                          <Pencil size={11} />Edit
                        </button>
                        {member.status === 'active' && (
                          <button onClick={() => setConfirmDeactivate(member)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-sm)] hover:opacity-80 transition-opacity">
                            <UserX size={11} />Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Pending Invitations */}
      {(invitations.length > 0 || invitationsQuery.isLoading) && (
        <div className="space-y-3">
          <h2 className="text-[13px] font-semibold text-ink-2">Pending Invitations</h2>

          <Card className="overflow-hidden p-0">
            {invitationsQuery.isLoading ? (
              <div className="px-6 py-8 text-center text-[13px] text-ink-3">
                Loading invitations&hellip;
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">
                      Email
                    </th>
                    <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">
                      Role
                    </th>
                    <th className="text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">
                      Invited
                    </th>
                    {canManageStaff && (
                      <th className="text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-[1px] px-6 py-3">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invitations.map((inv: StaffInvitation) => (
                    <tr key={inv.id} className="hover:bg-surface-2 transition-colors group">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-surface-3 border border-line flex items-center justify-center">
                            <Mail size={14} className="text-ink-3" />
                          </div>
                          <p className="text-[13px] text-ink font-medium">{inv.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <RoleBadge role={inv.role} />
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                          <Clock size={13} />
                          {relativeTime(inv.invited_at)}
                        </div>
                      </td>
                      {canManageStaff && (
                        <td className="px-6 py-3.5">
                          <div className="flex items-center justify-end gap-2 transition-opacity">
                            <button
                              onClick={() => resendMutation.mutate(inv.id)}
                              disabled={resendMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ink-2 bg-surface-2 border border-line rounded-[var(--r-sm)] hover:bg-surface-3 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={12} />
                              Resend
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false)
            setInviteSuccess(true)
          }}
        />
      )}

      {showAddDirectModal && (
        <AddDirectModal
          onClose={() => setShowAddDirectModal(false)}
          onSuccess={() => {
            setShowAddDirectModal(false)
            setInviteSuccess(true)
          }}
        />
      )}

      {/* Edit Staff Modal */}
      {editStaff && (
        <EditStaffModal
          staff={editStaff}
          onClose={() => setEditStaff(null)}
          onSuccess={() => setEditStaff(null)}
        />
      )}

      {/* Confirm Deactivate Dialog */}
      {confirmDeactivate && (
        <ConfirmDeactivateDialog
          staff={confirmDeactivate}
          loading={deactivateMutation.isPending}
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={() => deactivateMutation.mutate(confirmDeactivate.user_id)}
        />
      )}
    </div>
  )
}
