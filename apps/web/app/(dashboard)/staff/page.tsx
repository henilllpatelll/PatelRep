'use client'

import { Suspense, useState, useMemo, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
  UserPlus,
  X,
  Mail,
  AlertTriangle,
  Calendar,
  Plus,
  Trash2,
} from 'lucide-react'
import { staffApi, type StaffMember, type StaffInvitation, type RoleSchedule, type CustomRole } from '@/lib/api/staff'
import { getDisplayName } from '@/lib/utils/avatar'
import { useRole } from '@/lib/hooks/useRole'
import type { UserRole } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { Avatar, SectionLabel } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { schedulingApi } from '@/lib/api/scheduling'
import { useAuthStore } from '@/stores/authStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import {
  DEFAULT_FILTERS, buildDirectory, buildTodayMap, decodeFilters, encodeFilters, filterDirectory, hasActiveFilters,
  hotelToday, sortDirectory, summarize, type DirectoryFilters, type InvitationEntry, type SortKey, type StaffEntry,
} from '@/lib/people/peopleDirectory'
import { PeopleDirectorySkeleton, PeopleDirectoryTable, PeopleMobileCards } from '@/components/people/PeopleDirectory'
import { PeopleFilters } from '@/components/people/PeopleFilters'
import { PeopleInviteMenu } from '@/components/people/PeopleInviteMenu'
import { PeopleSummary } from '@/components/people/PeopleSummary'
import type { RowActionHandlers } from '@/components/people/PeopleRowActions'
import { usePeopleLabels, type TodaySource } from '@/components/people/usePeopleLabels'

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
  engineer: 'Engineer',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  front_desk: 'Front Desk',
}

// â”€â”€â”€ Invite form schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const inviteSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['gm', 'housekeeping_supervisor', 'housekeeper', 'engineer', 'chief_engineer', 'front_desk'], {
    error: 'Select a role',
  }),
  department_id: z.string().optional(),
})

type InviteFormValues = z.infer<typeof inviteSchema>

const directSchema = inviteSchema.extend({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type DirectFormValues = z.infer<typeof directSchema>

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          <span className="font-medium">{getDisplayName(staff.full_name)}</span>? They will lose access to PatelRep.
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
            {loading ? 'Deactivating…' : 'Deactivate'}
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
            <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 hover:bg-surface/60"><X size={18} /></IconButton>
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
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 hover:bg-surface/60"><X size={18} /></IconButton>
        </div>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="px-6 py-5 space-y-4">
          <p className="text-xs text-gray-500">Creates an account immediately — no email sent. You set the initial password to share with the staff member.</p>
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
              <UserPlus size={15} />{isSubmitting ? 'Adding…' : 'Add Staff'}
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
  onSuccess: (invitation: StaffInvitation) => void
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
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] })
      onSuccess(res.data)
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
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 hover:bg-surface/60"
          >
            <X size={18} />
          </IconButton>
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
              {isSubmitting ? 'Sending…' : 'Send Invite'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Schedule helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SCHEDULE_OVERRIDE: Partial<Record<UserRole, 'housekeeping_supervisor' | 'engineer'>> = {
  housekeeper: 'housekeeping_supervisor',
  engineer: 'engineer',
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function formatScheduleDays(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' · ')
}

// â”€â”€â”€ Edit Staff Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EditStaffModal({
  staff,
  onClose,
  onSuccess,
  v2,
}: {
  staff: StaffMember
  onClose: () => void
  onSuccess: () => void
  v2: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [role, setRole] = useState<UserRole>(staff.role)
  const [customRoleId, setCustomRoleId] = useState<string | null>(staff.custom_role_id ?? null)
  const [hourlyRate, setHourlyRate] = useState<string>(staff.hourly_rate != null ? String(staff.hourly_rate) : '')
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
    mutationFn: () => staffApi.update(staff.user_id, {
      role,
      custom_role_id: customRoleId,
      hourly_rate: hourlyRate === '' ? undefined : Number(hourlyRate),
    }),
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
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 hover:bg-surface/60">
            <X size={18} />
          </IconButton>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <Avatar name={getDisplayName(staff.full_name)} size={32} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{getDisplayName(staff.full_name)}</p>
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

          {/* Hourly rate — GM-only field, this whole page is already GM-gated */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">{t('staff.editModal.hourlyRateLabel')}</label>
            <input
              type="number"
              min={0}
              max={500}
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder={t('staff.editModal.hourlyRatePlaceholder')}
              className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
            <p className="text-xs text-gray-500">{t('staff.editModal.hourlyRateHint')}</p>
          </div>

          {/* Custom Role */}
          {v2 && customRolesQuery.isLoading ? (
            <div className="space-y-1.5 border-t border-white/60 pt-4">
              <Skeleton className="h-3.5 w-24 rounded-md" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ) : v2 && customRolesQuery.isError ? (
            <div className="border-t border-white/60 pt-4">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg">
                <span className="flex items-center gap-1.5 text-xs text-[var(--alert)]">
                  <AlertTriangle size={13} className="shrink-0" />
                  {t('staff.editModal.rolesLoadError')}
                </span>
                <Button variant="ghost" size="sm" onClick={() => customRolesQuery.refetch()} className="h-7 px-2 text-xs shrink-0">
                  Retry
                </Button>
              </div>
            </div>
          ) : (customRolesQuery.data ?? []).length > 0 && (
            <div className="space-y-1.5 border-t border-white/60 pt-4">
              <label className="block text-sm font-medium text-gray-700">Custom Role</label>
              <p className="text-xs text-gray-500">Override this staff member's sidebar with a custom permission set.</p>
              <select
                value={customRoleId ?? ''}
                onChange={(e) => setCustomRoleId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              >
                <option value="">— None (use base role) —</option>
                {(customRolesQuery.data ?? []).map((cr: CustomRole) => (
                  <option key={cr.id} value={cr.id}>{cr.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Role Schedule — only for housekeeper / engineer */}
          {overrideRole && (
            <div className="space-y-3 border-t border-white/60 pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Calendar size={14} className="text-[var(--caution)]" />
                Role Schedule
              </div>
              <p className="text-xs text-gray-500">
                On scheduled days,{' '}
                <span className="font-medium">{getDisplayName(staff.full_name).split(' ')[0]}</span> acts as{' '}
                <span className="font-medium">{ROLE_LABELS[overrideRole]}</span> — full dashboard
                and feature access for that role.
              </p>

              {/* Existing schedules */}
              {v2 && schedulesQuery.isLoading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-8 w-full rounded-lg" />
                  <Skeleton className="h-8 w-full rounded-lg" />
                </div>
              ) : v2 && schedulesQuery.isError ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--alert)]">
                    <AlertTriangle size={13} className="shrink-0" />
                    {t('staff.editModal.schedulesLoadError')}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => schedulesQuery.refetch()} className="h-7 px-2 text-xs shrink-0">
                    Retry
                  </Button>
                </div>
              ) : schedulesQuery.isLoading ? (
                <p className="text-xs text-gray-400">Loading…</p>
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
                          → {ROLE_LABELS[overrideRole]}
                        </span>
                      </span>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteScheduleMutation.mutate(s.id)}
                        disabled={deleteScheduleMutation.isPending}
                        aria-label="Remove schedule"
                        className="text-gray-400 hover:text-[var(--alert)]"
                      >
                        <Trash2 size={13} />
                      </IconButton>
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
                  {createScheduleMutation.isPending ? 'Adding…' : 'Add Schedule'}
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
              disabled={updateMutation.isPending || (role === staff.role && customRoleId === (staff.custom_role_id ?? null) && hourlyRate === (staff.hourly_rate != null ? String(staff.hourly_rate) : ''))}
              className="flex-1"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Role'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// â”€â”€â”€ Staff Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StaffPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isGM } = useRole()
  const authLoading = useAuthStore((s) => s.isLoading)
  const queryClient = useQueryClient()
  const { t, roleLabel } = usePeopleLabels()
  const hotel = useHotelStore((s) => s.hotel)
  const hotelId = hotel?.id ?? null
  const v2 = isSectionRedesigned('staff', hotel)

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showAddDirectModal, setShowAddDirectModal] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<StaffMember | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<InvitationEntry | null>(null)
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // ── Filter state: initialised from, and written back to, the URL (defaults omitted) ──
  const [filters, setFilters] = useState<DirectoryFilters>(() => decodeFilters(new URLSearchParams(searchParams.toString())))
  const [searchInput, setSearchInput] = useState(filters.q)
  const patchFilters = (patch: Partial<DirectoryFilters>) => setFilters((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === searchInput ? f : { ...f, q: searchInput })), 200)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    const qs = encodeFilters(filters)
    if (qs !== window.location.search.replace(/^\?/, '')) router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [filters, pathname, router])

  // A department id from another hotel must not survive a hotel switch.
  const lastHotel = useRef(hotelId)
  useEffect(() => {
    if (lastHotel.current !== hotelId) {
      lastHotel.current = hotelId
      setFilters((f) => (f.department ? { ...f, department: '' } : f))
      setNotice(null)
    }
  }, [hotelId])

  useEffect(() => {
    if (notice?.tone !== 'success') return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  // ── Data: every key is scoped to the active hotel; no per-person requests ──
  const enabled = isGM && !!hotelId
  const staffQuery = useQuery({
    queryKey: ['staff', 'directory', hotelId],
    queryFn: () => staffApi.list({ status: 'all' }),
    select: (res) => res.data.staff,
    enabled,
  })
  const invitationsQuery = useQuery({
    queryKey: ['staff-invitations', 'open', hotelId],
    queryFn: () => staffApi.listInvitations('open'),
    select: (res) => res.data.invitations,
    enabled,
  })
  const departmentsQuery = useQuery({
    queryKey: ['people-departments', hotelId],
    queryFn: () => staffApi.listDepartments(),
    select: (res) => res.data,
    enabled,
    staleTime: 300_000,
  })
  const todayDate = hotelToday(hotel?.timezone)
  const todayQuery = useQuery({
    queryKey: ['people-today', hotelId, todayDate],
    queryFn: () => schedulingApi.listAssignments({ work_date: todayDate as string }),
    select: (res) => res.data,
    enabled: enabled && !!todayDate,
    staleTime: 60_000,
  })

  const departments = departmentsQuery.data
  const departmentNames = useMemo(
    () => Object.fromEntries((departments ?? []).map((d) => [d.id, d.name])),
    [departments],
  )
  const directory = useMemo(
    () => (staffQuery.data ? buildDirectory(staffQuery.data, invitationsQuery.data ?? [], departmentNames) : []),
    [staffQuery.data, invitationsQuery.data, departmentNames],
  )
  const todayMap = useMemo(() => (todayQuery.data ? buildTodayMap(todayQuery.data) : undefined), [todayQuery.data])

  const source = (q: { isLoading: boolean; isError: boolean }, missing = false): TodaySource =>
    q.isError || missing ? 'error' : q.isLoading ? 'loading' : 'ready'
  const sources = {
    staff: source(staffQuery),
    invitations: source(invitationsQuery),
    // Without a valid hotel timezone we cannot say what "today" is, so the schedule is unavailable.
    today: source(todayQuery, !todayDate),
  }
  const summary = summarize(staffQuery.data, invitationsQuery.data, todayMap)

  const departmentOptions = useMemo(() => {
    const byId = new Map<string, string>((departments ?? []).map((d) => [d.id, d.name]))
    for (const e of directory) if (e.departmentId && e.departmentName && !byId.has(e.departmentId)) byId.set(e.departmentId, e.departmentName)
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [departments, directory])

  const visible = useMemo(
    () => sortDirectory(filterDirectory(directory, filters, roleLabel), filters, roleLabel),
    [directory, filters, roleLabel],
  )

  const clearFilters = () => { setSearchInput(''); setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir }) }
  const onSort = (key: SortKey) =>
    setFilters((f) => ({ ...f, sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc' }))

  // ── Mutations ──
  const fail = (err: unknown) =>
    setNotice({ tone: 'error', text: (err as Error)?.message || t('people.feedback.actionFailed') })

  const deactivateMutation = useMutation({
    mutationFn: (staffId: string) => staffApi.deactivate(staffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setConfirmDeactivate(null)
    },
    onError: (err) => { setConfirmDeactivate(null); fail(err) },
  })
  const reactivateMutation = useMutation({
    mutationFn: (entry: StaffEntry) => staffApi.reactivate(entry.staff.user_id),
    onMutate: (entry) => setBusyKey(entry.key),
    onSuccess: (_res, entry) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setNotice({ tone: 'success', text: t('people.feedback.reactivated', { name: entry.name || entry.email }) })
    },
    onError: fail,
    onSettled: () => setBusyKey(null),
  })
  const resendMutation = useMutation({
    mutationFn: (entry: InvitationEntry) => staffApi.resendInvitation(entry.invitation.id),
    onMutate: (entry) => setBusyKey(entry.key),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] })
      setNotice(deliveryNotice(res.data.email, res.data.delivery.status))
    },
    onError: fail,
    onSettled: () => setBusyKey(null),
  })
  const revokeMutation = useMutation({
    mutationFn: (entry: InvitationEntry) => staffApi.revokeInvitation(entry.invitation.id),
    onSuccess: (_res, entry) => {
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] })
      setNotice({ tone: 'success', text: t('people.feedback.revoked', { email: entry.email }) })
      setConfirmRevoke(null)
    },
    onError: (err) => { setConfirmRevoke(null); fail(err) },
  })

  // Wording follows what the email provider actually reported - never assume delivery.
  function deliveryNotice(email: string, status: string | null) {
    if (status === 'failed') return { tone: 'warning' as const, text: t('people.feedback.emailFailed', { email }) }
    if (status === 'existing_account') return { tone: 'warning' as const, text: t('people.feedback.existingAccount', { email }) }
    return { tone: 'success' as const, text: t('people.feedback.emailRequested', { email }) }
  }

  const handlers: RowActionHandlers = {
    onEdit: (e) => setEditStaff(e.staff),
    onDeactivate: (e) => setConfirmDeactivate(e.staff),
    onReactivate: (e) => reactivateMutation.mutate(e),
    onResend: (e) => resendMutation.mutate(e),
    onRevoke: (e) => setConfirmRevoke(e),
  }

  // ── Access: wait for auth to resolve before deciding anything ──
  if (authLoading || (isGM && !hotelId)) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-14 w-full" />
        <Card className="p-0"><PeopleDirectorySkeleton /></Card>
      </div>
    )
  }
  if (!isGM) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
          <AlertTriangle className="h-6 w-6 text-ink-3" />
        </div>
        <p className="text-sm font-medium text-ink-2">{t('people.restricted.title')}</p>
        <p className="mt-1 text-xs text-ink-3">{t('people.restricted.body')}</p>
      </div>
    )
  }

  const noPeopleAtAll = !!staffQuery.data && directory.length === 0
  const filtersActive = hasActiveFilters(filters)
  const openInvite = () => setShowInviteModal(true)

  return (
    <div className="space-y-5" data-i18n-skip="true">
      <PageHeader
        dataI18nSkip
        title={t('people.title')}
        subtitle={t('people.subtitle')}
        tabs={[
          { label: t('people.tabs.team'), active: true, dataI18nSkip: true },
          { label: t('people.tabs.schedule'), active: false, onClick: () => router.push('/scheduling'), dataI18nSkip: true },
        ]}
        actions={<PeopleInviteMenu onInvite={openInvite} onCreateManually={() => setShowAddDirectModal(true)} />}
      />

      <PeopleSummary
        summary={summary}
        sources={sources}
        onShowPending={() => { setSearchInput(''); setFilters({ ...DEFAULT_FILTERS, status: 'invited' }) }}
      />

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${
            notice.tone === 'success'
              ? 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]'
              : notice.tone === 'warning'
                ? 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]'
                : 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('people.feedback.dismiss')} className="shrink-0 rounded p-0.5 hover:opacity-70">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Partial failures: keep the directory usable and say exactly what is missing. */}
      {staffQuery.data && invitationsQuery.isError && (
        <PartialWarning text={t('people.errors.invitations')} onRetry={() => invitationsQuery.refetch()} />
      )}
      {staffQuery.data && todayQuery.isError && (
        <PartialWarning text={t('people.errors.today')} onRetry={() => todayQuery.refetch()} />
      )}

      <PeopleFilters
        search={searchInput}
        onSearch={setSearchInput}
        filters={filters}
        onChange={patchFilters}
        onClear={clearFilters}
        departments={departmentOptions}
        showUnassigned={directory.some((e) => !e.departmentId)}
      />

      <SectionLabel hint={staffQuery.data ? t('people.list.count', { count: visible.length }) : undefined}>
        {t('people.list.heading')}
      </SectionLabel>
      <Card className="p-0">
        {staffQuery.isLoading ? (
          <div role="status" aria-label={t('people.list.loading')}><PeopleDirectorySkeleton /></div>
        ) : staffQuery.isError ? (
          <StateBlock status="error" error={{ message: t('people.errors.load'), onRetry: () => staffQuery.refetch() }} />
        ) : noPeopleAtAll ? (
          <EmptyState
            icon={<UserPlus size={20} aria-hidden="true" />}
            title={t('people.empty.noneTitle')}
            body={t('people.empty.noneBody')}
            action={<Button variant="primary" onClick={openInvite}><Mail size={16} aria-hidden="true" />{t('people.invite.primary')}</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t('people.empty.filteredTitle')}
            body={t('people.empty.filteredBody')}
            action={filtersActive ? <Button variant="outline" onClick={clearFilters}>{t('people.filters.clear')}</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <PeopleDirectoryTable
                entries={visible} today={todayMap} todaySource={sources.today} sort={filters.sort} dir={filters.dir}
                onSort={onSort} handlers={handlers} busyKey={busyKey}
              />
            </div>
            <div className="lg:hidden">
              <PeopleMobileCards
                entries={visible} today={todayMap} todaySource={sources.today} sort={filters.sort} dir={filters.dir}
                onSort={onSort} handlers={handlers} busyKey={busyKey}
              />
            </div>
          </>
        )}
      </Card>

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={(invitation) => {
            setShowInviteModal(false)
            setNotice(deliveryNotice(invitation.email, invitation.delivery?.status ?? null))
          }}
        />
      )}

      {showAddDirectModal && (
        <AddDirectModal
          onClose={() => setShowAddDirectModal(false)}
          onSuccess={() => {
            setShowAddDirectModal(false)
            setNotice({ tone: 'success', text: t('people.feedback.accountCreated') })
          }}
        />
      )}

      {editStaff && (
        <EditStaffModal
          staff={editStaff}
          onClose={() => setEditStaff(null)}
          onSuccess={() => setEditStaff(null)}
          v2={v2}
        />
      )}

      {confirmDeactivate && (
        <ConfirmDeactivateDialog
          staff={confirmDeactivate}
          loading={deactivateMutation.isPending}
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={() => deactivateMutation.mutate(confirmDeactivate.user_id)}
        />
      )}

      <DeleteConfirmDialog
        open={!!confirmRevoke}
        title={t('people.revoke.title')}
        description={confirmRevoke ? t('people.revoke.body', { email: confirmRevoke.email }) : undefined}
        confirmLabel={t('people.revoke.confirm')}
        loading={revokeMutation.isPending}
        onCancel={() => setConfirmRevoke(null)}
        onConfirm={() => confirmRevoke && revokeMutation.mutate(confirmRevoke)}
      />
    </div>
  )
}

function PartialWarning({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] px-4 py-2.5 text-[13px] text-[var(--caution)]">
      <span className="flex items-center gap-2"><AlertTriangle size={14} aria-hidden="true" />{text}</span>
      <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">{t('common.retry')}</button>
    </div>
  )
}

export default function StaffPage() {
  // useSearchParams requires a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <StaffPageContent />
    </Suspense>
  )
}
