/**
 * Pure helpers for the Integrations settings screen (Oracle OPERA Cloud).
 *
 * Everything here is derived from what the API really returns: `GET /integrations/opera/status`
 * only says whether credentials are stored and a connection was authenticated when it was saved
 * (`is_connected`), plus the last successful sync time. It does NOT record connection-test results or
 * the outcome of the last sync — those are only known for the current browser session, and the UI
 * labels them that way.
 */
import type {
  OperaConflictSnapshot, OperaConflictResolution, OperaStatus, OperaSyncConflict,
} from '@/lib/api/integrations'
import { errorStatus } from '@/lib/settings/apiErrors'

export const OPERA_NAME = 'Oracle OPERA Cloud'

/** `connection_mode` is "api" (OHIP) by default, or "sftp_report" for scheduled report ingestion. */
export function isSftpMode(status: Pick<OperaStatus, 'connection_mode'> | undefined | null): boolean {
  return status?.connection_mode === 'sftp_report'
}

export function connectionModeLabel(status: Pick<OperaStatus, 'connection_mode'> | undefined | null): string {
  return isSftpMode(status) ? 'Scheduled report ingestion (SFTP)' : 'OHIP API'
}

// ─── Status errors ────────────────────────────────────────────────────────────

export interface StatusProblem {
  title: string
  detail: string
  /** A retry can only help when the failure may be transient. */
  retryable: boolean
}

/** Turn a failed status request into something a GM can act on. 403 is the pilot-enrollment gate. */
export function describeStatusProblem(err: unknown): StatusProblem {
  const status = errorStatus(err)
  if (status === 403) {
    return {
      title: 'OPERA Cloud isn’t enabled for this property',
      detail: 'This property hasn’t been enrolled in the OPERA Cloud pilot. Contact PatelRep support to enable it.',
      retryable: false,
    }
  }
  if (status === 503) {
    return {
      title: 'OPERA Cloud is unavailable in this environment',
      detail: 'The integration is switched off here. Nothing is wrong with your connection settings.',
      retryable: false,
    }
  }
  return {
    title: 'We couldn’t load the OPERA Cloud connection',
    detail: 'This looks temporary. Try again in a moment.',
    retryable: true,
  }
}

/** Which kind of failure an action produced — configuration problems need different guidance than outages. */
export function classifyActionFailure(err: unknown): 'auth_or_config' | 'unreachable' | 'other' {
  const status = errorStatus(err)
  if (status === 400 || status === 401 || status === 403 || status === 422) return 'auth_or_config'
  if (status === 502 || status === 503 || status === 504) return 'unreachable'
  return 'other'
}

// ─── Display formatting ───────────────────────────────────────────────────────

/** "Oct 8, 2026, 3:02 PM", or null when the value is missing/invalid (so the UI can show a neutral dash). */
export function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

/** Coarse "x minutes ago"; falls back to null for missing/invalid/future values. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 0) return null
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Show an endpoint without anything that could carry a secret: https only, origin plus path, no
 * user-info, query string or fragment. Returns null for anything that doesn't parse.
 */
export function safeEndpoint(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

// ─── Connect form ─────────────────────────────────────────────────────────────

export interface ConnectFormValues {
  ohip_base_url: string
  hotel_id_opera: string
  integration_username: string
  integration_password: string
}

export type ConnectFormErrors = Partial<Record<keyof ConnectFormValues, string>>

export const EMPTY_CONNECT_FORM: ConnectFormValues = {
  ohip_base_url: '', hotel_id_opera: '', integration_username: '', integration_password: '',
}

/** Mirrors the backend limits (endpoint 8–2048 chars, property code 1–64) and requires https for the endpoint. */
export function validateConnectForm(values: ConnectFormValues): ConnectFormErrors {
  const errors: ConnectFormErrors = {}
  const endpoint = values.ohip_base_url.trim()
  if (!endpoint) errors.ohip_base_url = 'Enter the OHIP endpoint.'
  else if (endpoint.length > 2048) errors.ohip_base_url = 'The endpoint is too long.'
  else if (!safeEndpoint(endpoint)) errors.ohip_base_url = 'Enter a full https:// address, such as https://hospitality.oracle.com.'

  const code = values.hotel_id_opera.trim()
  if (!code) errors.hotel_id_opera = 'Enter the OPERA property code.'
  else if (code.length > 64) errors.hotel_id_opera = 'The property code can be at most 64 characters.'

  const hasUser = values.integration_username.trim() !== ''
  const hasPassword = values.integration_password !== ''
  if (hasUser && !hasPassword) errors.integration_password = 'Enter the password for this integration user.'
  if (hasPassword && !hasUser) errors.integration_username = 'Enter the integration username, or clear the password.'
  return errors
}

export function connectFormDirty(values: ConnectFormValues, initial: ConnectFormValues): boolean {
  return (Object.keys(values) as (keyof ConnectFormValues)[]).some((key) => values[key] !== initial[key])
}

/** The exact request body: blank optional credentials are omitted, never sent as empty strings. */
export function buildConnectPayload(values: ConnectFormValues) {
  return {
    ohip_base_url: values.ohip_base_url.trim(),
    hotel_id_opera: values.hotel_id_opera.trim(),
    integration_username: values.integration_username.trim() || undefined,
    integration_password: values.integration_password || undefined,
  }
}

// ─── Conflicts ────────────────────────────────────────────────────────────────

export interface ConflictFieldRow {
  key: keyof OperaConflictSnapshot
  label: string
  local: string
  remote: string
  differs: boolean
}

const CONFLICT_FIELDS: { key: keyof OperaConflictSnapshot; label: string; phrase: string }[] = [
  { key: 'guest_name', label: 'Guest name', phrase: 'guest name' },
  { key: 'vip_flag', label: 'VIP', phrase: 'VIP status' },
  { key: 'checkin_time', label: 'Check-in', phrase: 'check-in time' },
  { key: 'checkout_time', label: 'Check-out', phrase: 'check-out time' },
]

function displayValue(key: keyof OperaConflictSnapshot, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (key === 'vip_flag') return value ? 'Yes' : 'No'
  if (key === 'checkin_time' || key === 'checkout_time') {
    return formatTimestamp(String(value)) ?? String(value)
  }
  return String(value)
}

/**
 * The fields a "resolve" actually decides — and nothing else. The snapshots can contain more (guest
 * email, preferences, special requests…); those are deliberately never read here.
 */
export function conflictFieldRows(conflict: Pick<OperaSyncConflict, 'local_snapshot' | 'remote_snapshot'>): ConflictFieldRow[] {
  const local = conflict.local_snapshot ?? {}
  const remote = conflict.remote_snapshot ?? {}
  return CONFLICT_FIELDS
    .filter(({ key }) => local[key] != null || remote[key] != null)
    .map(({ key, label }) => {
      const l = displayValue(key, local[key])
      const r = displayValue(key, remote[key])
      return { key, label, local: l, remote: r, differs: l !== r }
    })
}

export function conflictResourceLabel(conflict: Pick<OperaSyncConflict, 'entity_type' | 'external_id'>): string {
  return `${conflict.entity_type === 'room_status' ? 'Room status' : 'Reservation'} ${conflict.external_id}`
}

/** One safe sentence for the list row, e.g. "Guest name and check-in differ." */
export function conflictSummary(conflict: Pick<OperaSyncConflict, 'local_snapshot' | 'remote_snapshot'>): string {
  const differing = conflictFieldRows(conflict)
    .filter((row) => row.differs)
    .map((row) => CONFLICT_FIELDS.find((f) => f.key === row.key)?.phrase ?? row.label)
  if (differing.length === 0) return 'PatelRep and OPERA disagree on this record.'
  const list = differing.length === 1
    ? differing[0]
    : `${differing.slice(0, -1).join(', ')} and ${differing[differing.length - 1]}`
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${differing.length === 1 ? 'differs' : 'differ'} between PatelRep and OPERA.`
}

export interface ResolutionOption {
  value: OperaConflictResolution
  label: string
  consequence: string
}

/**
 * The backend resolves a conflict as a whole record ("local_wins" / "remote_wins"), not field by field.
 * "remote_wins" overwrites the room's guest name, VIP flag and check-in/out times with OPERA's values;
 * "local_wins" only closes the conflict. Either way the decision and the person are audited. If the
 * systems still differ, a later sync can flag the record again.
 */
export const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  {
    value: 'local_wins',
    label: 'Keep PatelRep Value',
    consequence: 'PatelRep’s data stays as it is and this conflict is closed. If OPERA still differs, a later sync can flag it again.',
  },
  {
    value: 'remote_wins',
    label: 'Use OPERA Value',
    consequence: 'Replaces PatelRep’s guest name, VIP flag and check-in/check-out times for this room with OPERA’s values, for the whole record.',
  },
] as const

// ─── Session-only results ─────────────────────────────────────────────────────

export interface SessionResult {
  ok: boolean
  message: string
  at: string
}

export function sessionResult(ok: boolean, message: string, now: Date = new Date()): SessionResult {
  return { ok, message, at: now.toISOString() }
}

export type OperaBadgeTone = 'ready' | 'alert' | 'caution' | 'neutral'

export interface OperaBadge { label: string; tone: OperaBadgeTone }

/**
 * Headline state for the card. Priority: in-flight work, then problems, then the stored state.
 * "Connected" is only ever shown when the server said so; a failed in-session test downgrades it.
 */
export function deriveBadge(input: {
  connected: boolean
  testing: boolean
  syncing: boolean
  disconnecting: boolean
  openConflicts: number
  lastTest: SessionResult | null
  lastSync: SessionResult | null
}): OperaBadge {
  if (input.disconnecting) return { label: 'Disconnecting…', tone: 'caution' }
  if (!input.connected) return { label: 'Not connected', tone: 'neutral' }
  if (input.testing) return { label: 'Testing connection…', tone: 'caution' }
  if (input.syncing) return { label: 'Syncing…', tone: 'caution' }
  if (input.lastTest && !input.lastTest.ok) return { label: 'Connection problem', tone: 'alert' }
  if (input.lastSync && !input.lastSync.ok) return { label: 'Sync failed', tone: 'alert' }
  if (input.openConflicts > 0) return { label: 'Needs review', tone: 'caution' }
  return { label: 'Connected', tone: 'ready' }
}
