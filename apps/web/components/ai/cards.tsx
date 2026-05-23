import { Bed, Clock, HelpCircle, Users, Wrench } from 'lucide-react'
import type {
  AssignmentPreview,
  GuestRequestPreview,
  InsightsResponse,
  ParsedTask,
  WorkOrderPreview,
} from '@/lib/api/ai'

function priorityBadge(p: string) {
  if (p === 'urgent') return 'text-red-600 bg-red-50 border-red-200'
  if (p === 'normal') return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-stone-500 bg-stone-50 border-stone-200'
}

function taskTypeIcon(t: string) {
  if (t === 'housekeeping') return <Bed size={12} className="shrink-0" />
  if (t === 'engineering') return <Wrench size={12} className="shrink-0" />
  if (t === 'guest_request') return <Users size={12} className="shrink-0" />
  return <HelpCircle size={12} className="shrink-0" />
}

function confidenceLabel(c: number) {
  if (c >= 0.9) return null
  if (c >= 0.7) return <span className="text-xs text-amber-500">needs review</span>
  return <span className="text-xs text-red-500">low confidence</span>
}

interface TaskPreviewCardProps {
  task: ParsedTask
  index?: number
  editMode?: boolean
  onChange?: (i: number, field: keyof ParsedTask, value: string) => void
}

export function TaskPreviewCard({
  task,
  index = 0,
  editMode = false,
  onChange,
}: TaskPreviewCardProps) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 space-y-1.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium">
          {taskTypeIcon(task.task_type)}
          <span className="capitalize">{task.task_type.replace('_', ' ')}</span>
        </div>
        <div className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${priorityBadge(task.priority)}`}>
          {task.priority}
        </div>
      </div>
      {editMode && onChange ? (
        <input
          className="w-full text-sm font-medium text-stone-900 border border-stone-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
          value={task.title}
          onChange={(e) => onChange(index, 'title', e.target.value)}
        />
      ) : (
        <p className="text-sm font-medium text-stone-900">{task.title}</p>
      )}
      {task.room_number_display && <p className="text-xs text-stone-500">Room {task.room_number_display}</p>}
      <div className="flex items-center justify-between">
        {task.due_at && (
          <div className="flex items-center gap-1 text-xs text-stone-400">
            <Clock size={10} />
            <span>{new Date(task.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {confidenceLabel(task.confidence)}
      </div>
    </div>
  )
}

export function InsightsView({ data }: { data: InsightsResponse }) {
  const severityClass = (severity: string) => {
    if (severity === 'critical') return 'border-l-4 border-red-500 bg-red-50'
    if (severity === 'warning') return 'border-l-4 border-amber-400 bg-amber-50'
    return 'border-l-4 border-blue-400 bg-blue-50'
  }

  return (
    <div className="space-y-2 mt-2">
      {data.insights.map((ins, i) => (
        <div key={i} className={`rounded-lg px-3 py-2.5 ${severityClass(ins.severity)}`}>
          <p className="text-xs font-semibold text-stone-900">{ins.title}</p>
          <p className="text-xs text-stone-600 mt-0.5">{ins.detail}</p>
          <p className="text-xs text-amber-600 mt-1 font-medium">-&gt; {ins.action}</p>
        </div>
      ))}
    </div>
  )
}

export function WorkOrderCard({ wo }: { wo: WorkOrderPreview }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium">
          <Wrench size={12} className="shrink-0" />
          <span className="capitalize">{wo.category}</span>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${priorityBadge(wo.priority)}`}>
          {wo.priority}
        </span>
      </div>
      <p className="text-sm font-medium text-stone-900">{wo.title}</p>
      {wo.room_number && <p className="text-xs text-stone-400">Room {wo.room_number}</p>}
    </div>
  )
}

export function GuestRequestCard({ req }: { req: GuestRequestPreview }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium">
        <Users size={12} className="shrink-0" />
        <span>Guest Request</span>
      </div>
      <p className="text-sm font-medium text-stone-900">{req.title}</p>
      {req.room_number && <p className="text-xs text-stone-400">Room {req.room_number}</p>}
      {req.guest_name && <p className="text-xs text-stone-400">{req.guest_name}</p>}
    </div>
  )
}

export function AssignmentCard({ assignment }: { assignment: AssignmentPreview }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3 bg-white space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-stone-500 font-medium">
        <Users size={12} className="shrink-0" />
        <span>{assignment.staff_name_hint}</span>
        {!assignment.staff_id && <span className="text-amber-500 ml-1">not found</span>}
      </div>
      {assignment.room_numbers.length > 0 && (
        <p className="text-xs text-stone-600">Rooms: {assignment.room_numbers.join(', ')}</p>
      )}
      {assignment.task_ids.length > 0 && (
        <p className="text-xs text-stone-600">
          {assignment.task_ids.length} task{assignment.task_ids.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
