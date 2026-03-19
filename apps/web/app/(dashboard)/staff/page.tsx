'use client'

import { useState, useMemo } from 'react'
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
} from 'lucide-react'
import { staffApi, type StaffMember, type StaffInvitation } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import type { UserRole } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Constants ────────────────────────────────────────────────────────────────

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

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  gm: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  housekeeping_supervisor: 'bg-teal-50 text-teal-700 border border-teal-200',
  housekeeper: 'bg-sky-50 text-sky-700 border border-sky-200',
  chief_engineer: 'bg-amber-50 text-amber-700 border border-amber-200',
  engineer: 'bg-slate-50 text-slate-600 border border-slate-200',
  front_desk: 'bg-violet-50 text-violet-700 border border-violet-200',
}

const ROLE_AVATAR_COLORS: Record<UserRole, string> = {
  gm: 'bg-violet-600',
  housekeeping_supervisor: 'bg-green-600',
  housekeeper: 'bg-teal-600',
  chief_engineer: 'bg-blue-600',
  engineer: 'bg-sky-600',
  front_desk: 'bg-amber-600',
}

// ─── Invite form schema ───────────────────────────────────────────────────────

const inviteSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Enter a valid email address'),
  role: z.enum(['gm', 'housekeeping_supervisor', 'housekeeper', 'chief_engineer', 'engineer', 'front_desk'], {
    errorMap: () => ({ message: 'Select a role' }),
  }),
  department_id: z.string().optional(),
})

type InviteFormValues = z.infer<typeof inviteSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE_COLORS[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  )
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

// ─── Confirm Deactivate Dialog ────────────────────────────────────────────────

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-indigo-950/20 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div className="relative bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Deactivate Staff Member</h3>
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
            {loading ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-indigo-950/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 className="text-lg font-semibold text-gray-900">Invite Staff Member</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {errors.root && (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
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
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors ${
                errors.full_name
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-indigo-200/40 hover:border-indigo-300'
              }`}
            />
            {errors.full_name && (
              <p className="text-xs text-red-600">{errors.full_name.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Email Address</label>
            <input
              {...register('email')}
              type="email"
              placeholder="maria@sunriseinn.com"
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors ${
                errors.email
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-indigo-200/40 hover:border-indigo-300'
              }`}
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              {...register('role')}
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors ${
                errors.role
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-indigo-200/40 hover:border-indigo-300'
              }`}
            >
              {ROLE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.role && (
              <p className="text-xs text-red-600">{errors.role.message}</p>
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

// ─── Staff Page ───────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { canManageStaff } = useRole()
  const queryClient = useQueryClient()

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState<StaffMember | null>(null)

  // Auto-dismiss invite success banner
  useMemo(() => {
    if (!inviteSuccess) return
    const t = setTimeout(() => setInviteSuccess(false), 4000)
    return () => clearTimeout(t)
  }, [inviteSuccess])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const staffQuery = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
    select: (res) => res.data.staff,
  })

  const invitationsQuery = useQuery({
    queryKey: ['staff-invitations'],
    queryFn: () => staffApi.listInvitations(),
    select: (res) => res.data.invitations,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

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

  // ── Filtering ──────────────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {staffQuery.data?.length ?? 0} team member
            {staffQuery.data?.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canManageStaff && (
          <Button
            variant="primary"
            onClick={() => setShowInviteModal(true)}
          >
            <UserPlus size={16} />
            Invite Staff
          </Button>
        )}
      </div>

      {/* Invite success banner */}
      {inviteSuccess && (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 font-medium">
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
            className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
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
            className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
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
            placeholder="Search by name or email…"
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg bg-white w-64 focus:outline-none focus:ring-2 focus:ring-brand-500 hover:border-gray-400 transition-colors"
          />
        </div>
      </div>

      {/* Staff table */}
      <Card variant="default" className="overflow-hidden p-0">
        {staffQuery.isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            Loading staff…
          </div>
        ) : staffQuery.isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-red-600 font-medium">Failed to load staff.</p>
            <button
              onClick={() => staffQuery.refetch()}
              className="mt-2 text-sm text-indigo-600 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            {searchQuery || roleFilter !== 'all' || statusFilter !== 'all'
              ? 'No staff match the current filters.'
              : 'No staff members yet. Invite your first team member above.'}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/60 bg-indigo-50/60">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                  Role
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                  Status
                </th>
                {canManageStaff && (
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              {filteredStaff.map((member) => (
                <tr key={member.id} className="hover:bg-indigo-50/40 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.full_name} role={member.role} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {member.full_name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <RoleBadge role={member.role} />
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        member.status === 'active'
                          ? 'text-green-700'
                          : 'text-gray-400'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          member.status === 'active' ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      />
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManageStaff && (
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            // Edit — stub for future modal
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                        {member.status === 'active' && (
                          <button
                            onClick={() => setConfirmDeactivate(member)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            <UserX size={12} />
                            Deactivate
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
          <h2 className="text-base font-semibold text-gray-900">Pending Invitations</h2>

          <Card variant="default" className="overflow-hidden p-0">
            {invitationsQuery.isLoading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">
                Loading invitations…
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/60 bg-indigo-50/60">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                      Email
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                      Role
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                      Invited
                    </th>
                    {canManageStaff && (
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/40">
                  {invitations.map((inv: StaffInvitation) => (
                    <tr key={inv.id} className="hover:bg-indigo-50/40 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                            <Mail size={14} className="text-gray-400" />
                          </div>
                          <p className="text-sm text-gray-700 font-medium">{inv.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge role={inv.role} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <Clock size={13} />
                          {relativeTime(inv.invited_at)}
                        </div>
                      </td>
                      {canManageStaff && (
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => resendMutation.mutate(inv.id)}
                              disabled={resendMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
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

      {/* Confirm Deactivate Dialog */}
      {confirmDeactivate && (
        <ConfirmDeactivateDialog
          staff={confirmDeactivate}
          loading={deactivateMutation.isPending}
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={() => deactivateMutation.mutate(confirmDeactivate.id)}
        />
      )}
    </div>
  )
}
