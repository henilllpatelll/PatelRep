/**
 * Pure helpers for Settings › Rooms & Accessibility: room rows, validation, list filtering and
 * URL state, plus CSV / manual import parsing and classification. No React, no network — unit tested.
 */
import type { ImportRoomPayload, RoomStatus } from '@/lib/api/rooms'

// ─── Room rows ────────────────────────────────────────────────────────────────

export interface RoomRow {
  id: string
  roomNumber: string
  floor: number | null
  building: string
  roomTypeId: string
  roomTypeCode: string
  roomTypeName: string
  /** Live operational status — shown read-only context in the drawer, never edited as master data. */
  status: string
}

export function toRoomRows(statuses: RoomStatus[]): RoomRow[] {
  return statuses
    .filter((s) => s.rooms)
    .map((s) => ({
      id: s.rooms!.id ?? s.room_id,
      roomNumber: String(s.rooms!.room_number ?? ''),
      floor: s.rooms!.floor ?? null,
      building: (s.rooms!.building ?? '').trim(),
      roomTypeId: (s.rooms as { room_type_id?: string }).room_type_id ?? '',
      roomTypeCode: s.rooms!.room_types?.code ?? '',
      roomTypeName: s.rooms!.room_types?.name ?? '',
      status: s.status,
    }))
}

export function compareRooms(a: RoomRow, b: RoomRow): number {
  const fa = a.floor ?? Number.MAX_SAFE_INTEGER
  const fb = b.floor ?? Number.MAX_SAFE_INTEGER
  if (fa !== fb) return fa - fb
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
}

export function normalizeRoomNumber(value: string): string {
  return value.trim().toLowerCase()
}

// ─── Filters, URL state, paging ───────────────────────────────────────────────

export const ROOMS_PAGE_SIZE = 50
export const ALL = 'all'

export interface RoomFilters {
  q: string
  building: string
  floor: string
  type: string
}

export const EMPTY_ROOM_FILTERS: RoomFilters = { q: '', building: ALL, floor: ALL, type: ALL }

export function hasActiveFilters(f: RoomFilters): boolean {
  return f.q.trim() !== '' || f.building !== ALL || f.floor !== ALL || f.type !== ALL
}

export function filterRooms(rows: RoomRow[], f: RoomFilters): RoomRow[] {
  const q = f.q.trim().toLowerCase()
  return rows
    .filter((r) => {
      if (q && !r.roomNumber.toLowerCase().includes(q)) return false
      if (f.building !== ALL && r.building !== f.building) return false
      if (f.floor !== ALL && String(r.floor) !== f.floor) return false
      if (f.type !== ALL && r.roomTypeId !== f.type) return false
      return true
    })
    .sort(compareRooms)
}

export function distinctBuildings(rows: RoomRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.building).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

export function distinctFloors(rows: RoomRow[]): number[] {
  return Array.from(new Set(rows.map((r) => r.floor).filter((f): f is number => f != null))).sort((a, b) => a - b)
}

export function paginate<T>(items: T[], page: number, pageSize = ROOMS_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  return { page: current, pages, total: items.length, items: items.slice((current - 1) * pageSize, current * pageSize) }
}

export type RoomsTabId = 'rooms' | 'accessibility'

export interface RoomsUrlState extends RoomFilters {
  tab: RoomsTabId
  page: number
}

type ParamReader = { get(name: string): string | null }

export function parseRoomsUrl(params: ParamReader): RoomsUrlState {
  const page = Number.parseInt(params.get('page') ?? '1', 10)
  return {
    tab: params.get('tab') === 'accessibility' ? 'accessibility' : 'rooms',
    q: params.get('q') ?? '',
    building: params.get('building') || ALL,
    floor: params.get('floor') || ALL,
    type: params.get('type') || ALL,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

/** Query string for the Rooms tab; defaults are omitted so a clean view has a clean URL. */
export function buildRoomsQuery(state: Partial<RoomsUrlState>): string {
  const p = new URLSearchParams()
  if (state.tab === 'accessibility') p.set('tab', 'accessibility')
  if (state.q?.trim()) p.set('q', state.q.trim())
  if (state.building && state.building !== ALL) p.set('building', state.building)
  if (state.floor && state.floor !== ALL) p.set('floor', state.floor)
  if (state.type && state.type !== ALL) p.set('type', state.type)
  if (state.page && state.page > 1) p.set('page', String(state.page))
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ─── Room form validation ─────────────────────────────────────────────────────

export interface RoomFormValues {
  roomNumber: string
  floor: string
  building: string
  roomTypeId: string
}

export type RoomFormErrors = Partial<Record<keyof RoomFormValues, string>>

export const EMPTY_ROOM_FORM: RoomFormValues = { roomNumber: '', floor: '', building: '', roomTypeId: '' }

export function roomToForm(room: RoomRow): RoomFormValues {
  return {
    roomNumber: room.roomNumber,
    floor: room.floor == null ? '' : String(room.floor),
    building: room.building,
    roomTypeId: room.roomTypeId,
  }
}

export function validateRoomForm(values: RoomFormValues, existing: RoomRow[], editingId?: string): RoomFormErrors {
  const errors: RoomFormErrors = {}
  const number = values.roomNumber.trim()
  if (!number) errors.roomNumber = 'Enter a room number.'
  else if (number.length > 20) errors.roomNumber = 'Room numbers can be at most 20 characters.'
  else if (existing.some((r) => r.id !== editingId && normalizeRoomNumber(r.roomNumber) === normalizeRoomNumber(number))) {
    errors.roomNumber = `Room ${number} already exists.`
  }

  const floorText = values.floor.trim()
  if (floorText === '') errors.floor = 'Enter a floor.'
  else if (!/^-?\d+$/.test(floorText) || Number(floorText) < -5 || Number(floorText) > 200) {
    errors.floor = 'Floor must be a whole number between -5 and 200.'
  }

  if (!values.roomTypeId) errors.roomTypeId = 'Choose a room type.'
  if (values.building.trim().length > 50) errors.building = 'Building can be at most 50 characters.'
  return errors
}

export function roomFormChanged(a: RoomFormValues, b: RoomFormValues): boolean {
  return (
    a.roomNumber.trim() !== b.roomNumber.trim() ||
    a.floor.trim() !== b.floor.trim() ||
    a.building.trim() !== b.building.trim() ||
    a.roomTypeId !== b.roomTypeId
  )
}

// ─── Import: parsing ──────────────────────────────────────────────────────────

export interface ImportDraftRow {
  /** 1-based line within the input (CSV line number, or manual row number). */
  line: number
  roomNumber: string
  floor: number | null
  typeCode: string
  typeName: string
  building: string
  errors: string[]
}

export const IMPORT_MAX_ROWS = 500
export const CSV_TEMPLATE = 'room_number,floor,room_type_code,room_type_name,building\n101,1,SD,Standard,A\n102,1,SD,Standard,A\n201,2,KS,King Suite,B\n'

/** RFC-4180-ish split: handles quoted fields, escaped quotes, CRLF and a leading BOM. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

const HEADER_ALIASES: Record<string, 'roomNumber' | 'floor' | 'typeCode' | 'typeName' | 'building'> = {
  room_number: 'roomNumber', 'room number': 'roomNumber', room: 'roomNumber', number: 'roomNumber',
  floor: 'floor',
  room_type_code: 'typeCode', 'room type code': 'typeCode', type: 'typeCode', code: 'typeCode', type_code: 'typeCode',
  room_type_name: 'typeName', 'room type name': 'typeName', type_name: 'typeName', 'type name': 'typeName',
  building: 'building',
}

export interface RawImportRow { roomNumber: string; floor: string; typeCode: string; typeName: string; building: string }

/** Validate one raw row (shared by CSV and manual entry). Nothing is defaulted silently. */
export function buildDraftRow(raw: RawImportRow, line: number): ImportDraftRow {
  const errors: string[] = []
  const roomNumber = raw.roomNumber.trim()
  const floorText = raw.floor.trim()
  let floor: number | null = null
  if (!roomNumber) errors.push('Room number is required.')
  else if (roomNumber.length > 20) errors.push('Room number is longer than 20 characters.')
  if (floorText === '') errors.push('Floor is required.')
  else if (!/^-?\d+$/.test(floorText) || Number(floorText) < -5 || Number(floorText) > 200) {
    errors.push(`Floor “${floorText}” must be a whole number between -5 and 200.`)
  } else floor = Number(floorText)
  const typeCode = raw.typeCode.trim().toUpperCase()
  if (!typeCode) errors.push('Room type code is required.')
  return { line, roomNumber, floor, typeCode, typeName: raw.typeName.trim(), building: raw.building.trim(), errors }
}

export interface CsvParseResult { rows: ImportDraftRow[]; fileError: string | null }

export function parseRoomsCsv(text: string): CsvParseResult {
  const table = splitCsv(text)
  if (table.length === 0) return { rows: [], fileError: 'The file is empty.' }
  const header = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null)
  const missing = (['roomNumber', 'floor', 'typeCode'] as const).filter((k) => !header.includes(k))
  if (missing.length > 0) {
    const names = { roomNumber: 'room_number', floor: 'floor', typeCode: 'room_type_code' }
    return { rows: [], fileError: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => names[m]).join(', ')}. The first line must be a header row.` }
  }
  if (table.length === 1) return { rows: [], fileError: 'The file has a header row but no rooms.' }
  if (table.length - 1 > IMPORT_MAX_ROWS) {
    return { rows: [], fileError: `A single import can contain at most ${IMPORT_MAX_ROWS} rooms (this file has ${table.length - 1}). Split it into smaller files.` }
  }
  const rows = table.slice(1).map((cells, i) => {
    const get = (key: (typeof HEADER_ALIASES)[string]) => {
      const idx = header.indexOf(key)
      return idx >= 0 ? (cells[idx] ?? '') : ''
    }
    return buildDraftRow(
      { roomNumber: get('roomNumber'), floor: get('floor'), typeCode: get('typeCode'), typeName: get('typeName'), building: get('building') },
      i + 2, // line number in the file (header is line 1)
    )
  })
  return { rows, fileError: null }
}

// ─── Import: classification ───────────────────────────────────────────────────

export type ImportRowState = 'new' | 'exists' | 'duplicate-in-file' | 'invalid'

export interface ClassifiedRow extends ImportDraftRow {
  state: ImportRowState
  /** Reasons shown to the user (validation errors or duplicate explanation). */
  messages: string[]
  /** The room type does not exist yet and will be created from the supplied name. */
  createsType: boolean
}

export interface ImportClassification {
  rows: ClassifiedRow[]
  counts: Record<ImportRowState, number>
  /** Distinct new room types that will be created. */
  newTypes: { code: string; name: string }[]
}

export function classifyImportRows(
  drafts: ImportDraftRow[],
  existingRooms: Pick<RoomRow, 'roomNumber'>[],
  knownTypeCodes: string[],
): ImportClassification {
  const existing = new Set(existingRooms.map((r) => normalizeRoomNumber(r.roomNumber)))
  const known = new Set(knownTypeCodes.map((c) => c.trim().toUpperCase()))
  const seen = new Map<string, number>()
  const newTypes = new Map<string, string>()

  const rows = drafts.map<ClassifiedRow>((d) => {
    const base = { ...d, messages: [...d.errors], createsType: false }
    if (d.errors.length > 0) return { ...base, state: 'invalid' }

    const key = normalizeRoomNumber(d.roomNumber)
    if (existing.has(key)) {
      return { ...base, state: 'exists', messages: [`Room ${d.roomNumber} already exists. It will be skipped and left exactly as it is.`] }
    }
    if (seen.has(key)) {
      return { ...base, state: 'duplicate-in-file', messages: [`Room ${d.roomNumber} also appears on line ${seen.get(key)}. Only the first one is imported.`] }
    }

    let createsType = false
    if (!known.has(d.typeCode)) {
      if (!d.typeName) {
        return { ...base, state: 'invalid', messages: [`Room type “${d.typeCode}” doesn’t exist yet. Add a room type name to create it, or use an existing code.`] }
      }
      createsType = true
    }
    seen.set(key, d.line)
    if (createsType && !newTypes.has(d.typeCode)) newTypes.set(d.typeCode, d.typeName)
    return { ...base, state: 'new', createsType }
  })

  const counts: Record<ImportRowState, number> = { new: 0, exists: 0, 'duplicate-in-file': 0, invalid: 0 }
  rows.forEach((r) => { counts[r.state] += 1 })
  return { rows, counts, newTypes: Array.from(newTypes, ([code, name]) => ({ code, name })) }
}

/** Only rows classified `new` are ever sent — existing rooms are never included, so none can be reset. */
export function toImportPayload(rows: ClassifiedRow[]): ImportRoomPayload[] {
  return rows
    .filter((r) => r.state === 'new')
    .map((r) => ({
      room_number: r.roomNumber,
      floor: r.floor as number,
      room_type_code: r.typeCode,
      ...(r.createsType || r.typeName ? { room_type_name: r.typeName || undefined } : {}),
      ...(r.building ? { building: r.building } : {}),
    }))
}

export interface ImportOutcome {
  imported: number
  /** Rooms the server reported as already present (it resets their status — we never send these on purpose). */
  alreadyExisted: number
  failed: { roomNumber: string; reason: string }[]
}

export function summarizeImportResult(
  data: { imported_count?: number; reset_count?: number; errors?: { room_number: string | null; reason: string }[] } | null | undefined,
): ImportOutcome {
  return {
    imported: data?.imported_count ?? 0,
    alreadyExisted: data?.reset_count ?? 0,
    failed: (data?.errors ?? []).map((e) => ({ roomNumber: e.room_number ?? '—', reason: e.reason })),
  }
}
