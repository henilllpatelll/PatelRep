'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Download, GraduationCap, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { safetyApi, type TrainingStatusRow } from '@/lib/api/safety'

const STATUS_STYLE: Record<string, string> = { compliant: 'bg-success-soft text-success', due_soon: 'bg-caution-soft text-caution', overdue: 'bg-alert-soft text-alert', not_applicable: 'bg-surface-2 text-ink3' }
const STATUS_LABEL: Record<string, string> = { compliant: 'Compliant', due_soon: 'Due soon', overdue: 'Overdue', not_applicable: 'Not applicable' }
const COVERAGE_ROLES = ['housekeeper', 'housekeeping_supervisor', 'engineer', 'chief_engineer', 'front_desk', 'gm']

export function ComplianceDashboard({ redesigned }: { redesigned?: boolean }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<TrainingStatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [covered, setCovered] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError(null); setLoadError(false)
    try { const response = await safetyApi.listTrainingStatus(); setRows(response.data) }
    catch { setError('Unable to load training compliance.'); setLoadError(true) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const applicable = rows.filter((row) => row.status !== 'not_applicable')
    const overdue = applicable.filter((row) => row.status === 'overdue').length
    const dueSoon = applicable.filter((row) => row.status === 'due_soon').length
    return { total: applicable.length, overdue, dueSoon }
  }, [rows])

  const exportCsv = async () => {
    const blob = await safetyApi.exportTrainingCsv()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'safety-training-compliance.csv'
    document.body.appendChild(link); link.click(); link.remove()
    URL.revokeObjectURL(url)
  }

  const toggleRole = (role: string) => setCovered((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role])

  const submitCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!covered.length) { setError('Select at least one covered role.'); return }
    setSaving(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await safetyApi.createCourse({
        provider_name: String(form.get('provider_name')),
        course_name: String(form.get('course_name')),
        course_code: String(form.get('course_code') || '') || null,
        covered_roles: covered,
        new_hire_deadline_days: Number(form.get('new_hire_deadline_days')) || 30,
        recurrence_months: Number(form.get('recurrence_months')) || 12,
      })
      event.currentTarget.reset(); setCovered([]); setShowForm(false)
      await load()
    } catch { setError('Unable to create the course.') }
    finally { setSaving(false) }
  }

  return (
    <section className="rounded-[var(--r-lg)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2"><GraduationCap size={18} className="text-accent" /><h2 className="font-medium text-ink">Training compliance</h2></div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setShowForm((v) => !v)}><Plus size={14} />Add course</Button>
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void exportCsv()} disabled={loading}><Download size={14} />Export CSV</Button>
        </div>
      </div>

      {error && !(redesigned && loadError) ? <p className="mx-4 mt-3 rounded-lg bg-alert-soft p-2 text-sm text-alert">{error}</p> : null}

      {showForm ? (
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2" onSubmit={(event) => void submitCourse(event)}>
          <input name="course_name" required placeholder="Course name" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="provider_name" required placeholder="Provider name" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="course_code" placeholder="Course code (optional)" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <div className="flex items-center gap-2">
            <input name="new_hire_deadline_days" type="number" min={1} max={365} defaultValue={30} className="w-24 rounded-lg border border-line bg-surface p-2 text-sm" aria-label="New-hire deadline days" />
            <span className="text-xs text-ink3">new-hire days</span>
            <input name="recurrence_months" type="number" min={1} max={60} defaultValue={12} className="w-24 rounded-lg border border-line bg-surface p-2 text-sm" aria-label="Recurrence months" />
            <span className="text-xs text-ink3">recur. months</span>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-ink2">Covered roles</p>
            <div className="flex flex-wrap gap-1.5">
              {COVERAGE_ROLES.map((role) => (
                <button key={role} type="button" onClick={() => toggleRole(role)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${covered.includes(role) ? 'bg-accent text-white' : 'bg-surface-2 text-ink2'}`}>{role.replace(/_/g, ' ')}</button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create course'}</Button></div>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-4 px-4 py-3 text-sm">
        <span className="text-ink2">Applicable requirements: <span className="font-semibold text-ink">{summary.total}</span></span>
        <span className="text-alert">Overdue: <span className="font-semibold">{summary.overdue}</span></span>
        <span className="text-caution">Due soon: <span className="font-semibold">{summary.dueSoon}</span></span>
      </div>

      <StateBlock
        status={loading ? 'loading' : redesigned && loadError ? 'error' : rows.length === 0 ? 'empty' : null}
        empty={{ title: redesigned ? t('safety.compliance.empty') : 'No training requirements yet. Add a course to begin.' }}
        error={{ message: t('safety.compliance.loadError'), onRetry: () => void load() }}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-y border-line text-left text-xs uppercase tracking-wide text-ink3">
              <th className="px-4 py-2 font-medium">Course</th><th className="px-4 py-2 font-medium">Role</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 font-medium">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={`${row.employee_id}-${row.course_id}`}>
                  <td className="px-4 py-2 text-ink">{row.course_name}</td>
                  <td className="px-4 py-2 text-ink2">{row.employee_role.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-ink3">{row.due_date ?? '—'}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateBlock>
    </section>
  )
}
