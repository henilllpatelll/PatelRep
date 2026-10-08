'use client'

import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Download, FileUp, Plus, X } from 'lucide-react'
import { roomsApi, type RoomType } from '@/lib/api/rooms'
import {
  CSV_TEMPLATE, buildDraftRow, classifyImportRows, parseRoomsCsv, summarizeImportResult, toImportPayload,
  type ClassifiedRow, type ImportDraftRow, type ImportOutcome, type RawImportRow, type RoomRow,
} from '@/lib/settings/rooms'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { Button, IconButton } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { SettingsTextInput, SettingsTextarea } from '@/components/settings/workspace/SettingsFormControls'
import { cn } from '@/lib/utils'
import { errorMessage, useInvalidateRooms } from './useRoomsData'

type Step = 'input' | 'review' | 'confirm' | 'result'
const STEPS: { id: Step; label: string }[] = [
  { id: 'input', label: 'Input' }, { id: 'review', label: 'Validate' }, { id: 'confirm', label: 'Confirm' }, { id: 'result', label: 'Result' },
]
const BLANK = (): RawImportRow => ({ roomNumber: '', floor: '', typeCode: '', typeName: '', building: '' })
const MAX_FILE_BYTES = 1_000_000

const STATE_META: Record<ClassifiedRow['state'], { label: string; tone: 'ready' | 'caution' | 'alert' | 'neutral' }> = {
  new: { label: 'Will be added', tone: 'ready' },
  exists: { label: 'Already exists — skipped', tone: 'neutral' },
  'duplicate-in-file': { label: 'Duplicate in input — skipped', tone: 'caution' },
  invalid: { label: 'Needs a fix', tone: 'alert' },
}

export function RoomsImportDialog({ existingRooms, types, onClose, onRefreshRooms }: {
  existingRooms: RoomRow[]
  types: RoomType[]
  onClose: () => void
  /** Re-fetch the room list so the duplicate check is made against current data. */
  onRefreshRooms: () => Promise<RoomRow[]>
}) {
  const invalidate = useInvalidateRooms()
  const ref = useRef<HTMLDivElement>(null!)
  const titleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  useModalFocusTrap(ref, true, onClose)

  const [step, setStep] = useState<Step>('input')
  const [method, setMethod] = useState<'csv' | 'manual'>('csv')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [manual, setManual] = useState<RawImportRow[]>(() => Array.from({ length: 5 }, BLANK))
  const [drafts, setDrafts] = useState<ImportDraftRow[]>([])
  const [inputError, setInputError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sent, setSent] = useState<ClassifiedRow[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [knownRooms, setKnownRooms] = useState<RoomRow[]>(existingRooms)

  const knownCodes = types.map((t) => t.code)
  const classification = classifyImportRows(drafts, knownRooms, knownCodes)
  const { counts } = classification
  const importable = counts.new

  function toReview() {
    setInputError(null)
    setNotice(null)
    if (method === 'csv') {
      const parsed = parseRoomsCsv(csvText)
      if (parsed.fileError) return setInputError(parsed.fileError)
      setDrafts(parsed.rows)
    } else {
      const filled = manual.map((r, i) => ({ r, line: i + 1 })).filter(({ r }) => Object.values(r).some((v) => v.trim() !== ''))
      if (filled.length === 0) return setInputError('Enter at least one room.')
      setDrafts(filled.map(({ r, line }) => buildDraftRow(r, line)))
    }
    setStep('review')
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setInputError('That file is larger than 1 MB. Split it into smaller files.'); return }
    const reader = new FileReader()
    reader.onload = (ev) => { setCsvText(String(ev.target?.result ?? '')); setFileName(file.name); setInputError(null) }
    reader.onerror = () => setInputError('We couldn’t read that file.')
    reader.readAsText(file)
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'rooms-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setSubmitError(null)
    try {
      // Re-check against current data so a room added by someone else meanwhile is never sent.
      const fresh = await onRefreshRooms()
      setKnownRooms(fresh)
      const recheck = classifyImportRows(drafts, fresh, knownCodes)
      if (recheck.counts.new !== importable) {
        setNotice('Your room list changed while you were reviewing. Please check the updated results.')
        setAcknowledged(false)
        setStep('review')
        return
      }
      const rows = recheck.rows
      const res = await roomsApi.importRooms(toImportPayload(rows), method)
      setSent(rows.filter((r) => r.state === 'new'))
      setOutcome(summarizeImportResult(res.data))
      await invalidate()
      setStep('result')
    } catch (err) {
      setSubmitError(errorMessage(err, 'The import could not be completed. Nothing was confirmed — check your rooms before retrying.'))
    } finally {
      setBusy(false)
    }
  }

  async function retryFailed() {
    if (!outcome) return
    const failed = new Set(outcome.failed.map((f) => f.roomNumber))
    setKnownRooms(await onRefreshRooms())
    setDrafts(sent.filter((r) => failed.has(r.roomNumber)))
    setAcknowledged(false)
    setNotice('Retrying only the rooms that failed. Rooms that were imported are skipped automatically.')
    setStep('review')
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step)
  const newTypeNote = classification.newTypes.length > 0

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-[var(--r-lg)] border border-line bg-surface shadow-xl outline-none sm:rounded-[var(--r-lg)]">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-ink">Import rooms</h2>
            <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Import steps">
              {STEPS.map((s, i) => (
                <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={cn(i === stepIndex ? 'font-semibold text-ink' : i < stepIndex ? 'text-ink-2' : 'text-ink-4')}>
                  {i + 1}. {s.label}
                </li>
              ))}
            </ol>
          </div>
          <IconButton variant="ghost" onClick={onClose} aria-label="Close" disabled={busy}><X size={18} aria-hidden="true" /></IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && <p role="status" className="mb-3 rounded-lg bg-[var(--caution-soft)] px-3 py-2 text-[13px] text-ink">{notice}</p>}

          {step === 'input' && (
            <div className="space-y-4">
              <div role="tablist" aria-label="Import method" className="flex border-b border-line">
                {(['csv', 'manual'] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setInputError(null) }}
                    className={cn('-mb-px min-h-[44px] border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[40px]', method === m ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-ink-3 hover:text-ink')}>
                    {m === 'csv' ? 'Upload CSV' : 'Manual entry'}
                  </button>
                ))}
              </div>
              {inputError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{inputError}</p>}

              {method === 'csv' ? (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">
                    Columns: <code className="rounded bg-surface-3 px-1">room_number</code>, <code className="rounded bg-surface-3 px-1">floor</code>, <code className="rounded bg-surface-3 px-1">room_type_code</code> are required;{' '}
                    <code className="rounded bg-surface-3 px-1">room_type_name</code> (needed only to create a new type) and <code className="rounded bg-surface-3 px-1">building</code> are optional.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" aria-label="Choose CSV file" />
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><FileUp size={14} aria-hidden="true" /> Choose CSV file</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}><Download size={14} aria-hidden="true" /> Download template</Button>
                    {fileName && <span className="self-center text-xs text-ink-3">{fileName}</span>}
                  </div>
                  <label htmlFor="import-csv-text" className="block text-sm font-medium text-ink-2">Or paste CSV</label>
                  <SettingsTextarea id="import-csv-text" rows={8} value={csvText} onChange={(e) => { setCsvText(e.target.value); setFileName(null) }} className="font-mono text-xs" placeholder={'room_number,floor,room_type_code,room_type_name,building\n101,1,SD,Standard,A'} spellCheck={false} />
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink-2">Enter one room per row. Blank rows are ignored. A type code that doesn’t exist yet needs a type name.</p>
                  <datalist id="import-type-codes">{types.map((t) => <option key={t.id} value={t.code}>{t.name}</option>)}</datalist>
                  <div className="hidden grid-cols-[1fr_5rem_1fr_1.4fr_1fr_2.25rem] gap-2 text-xs font-medium text-ink-3 sm:grid" aria-hidden="true">
                    <span>Room number</span><span>Floor</span><span>Type code</span><span>Type name (new types)</span><span>Building</span><span />
                  </div>
                  {manual.map((row, i) => {
                    const upd = (k: keyof RawImportRow) => (e: React.ChangeEvent<HTMLInputElement>) => setManual((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))
                    return (
                      <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line-2 p-2 sm:grid-cols-[1fr_5rem_1fr_1.4fr_1fr_2.25rem] sm:border-0 sm:p-0">
                        <SettingsTextInput aria-label={`Row ${i + 1} room number`} placeholder="Room" value={row.roomNumber} onChange={upd('roomNumber')} maxLength={20} />
                        <SettingsTextInput aria-label={`Row ${i + 1} floor`} placeholder="Floor" inputMode="numeric" value={row.floor} onChange={upd('floor')} />
                        <SettingsTextInput aria-label={`Row ${i + 1} type code`} placeholder="Type code" list="import-type-codes" value={row.typeCode} onChange={upd('typeCode')} maxLength={10} />
                        <SettingsTextInput aria-label={`Row ${i + 1} type name`} placeholder="Type name" value={row.typeName} onChange={upd('typeName')} maxLength={50} />
                        <SettingsTextInput aria-label={`Row ${i + 1} building`} placeholder="Building" value={row.building} onChange={upd('building')} maxLength={50} />
                        <IconButton variant="ghost" size="sm" aria-label={`Remove row ${i + 1}`} onClick={() => setManual((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [BLANK()]))}><X size={14} aria-hidden="true" /></IconButton>
                      </div>
                    )
                  })}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setManual((rows) => (rows.length >= 100 ? rows : [...rows, ...Array.from({ length: 5 }, BLANK)]))}><Plus size={14} aria-hidden="true" /> Add 5 rows</Button>
                </div>
              )}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs" role="status">
                <Pill tone="ready">{counts.new} to add</Pill>
                {counts.exists > 0 && <Pill tone="neutral">{counts.exists} already exist</Pill>}
                {counts['duplicate-in-file'] > 0 && <Pill tone="caution">{counts['duplicate-in-file']} duplicate in input</Pill>}
                {counts.invalid > 0 && <Pill tone="alert">{counts.invalid} need a fix</Pill>}
              </div>
              <p className="text-xs text-ink-3">This preview is checked in your browser against your current room list. It can’t guarantee the server will accept every row — the result screen reports what was actually saved.</p>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <caption className="sr-only">Import preview</caption>
                  <thead><tr className="bg-surface-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <th scope="col" className="px-3 py-2">Line</th><th scope="col" className="px-3 py-2">Room</th><th scope="col" className="px-3 py-2">Floor</th>
                    <th scope="col" className="px-3 py-2">Type</th><th scope="col" className="px-3 py-2">Building</th><th scope="col" className="px-3 py-2">Result</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line-2">
                    {classification.rows.map((r) => (
                      <tr key={r.line} className={cn('align-top', r.state === 'invalid' && 'bg-[var(--alert-soft)]/40')}>
                        <td className="px-3 py-2 text-ink-3">{r.line}</td>
                        <td className="px-3 py-2 font-medium text-ink">{r.roomNumber || '—'}</td>
                        <td className="px-3 py-2">{r.floor ?? '—'}</td>
                        <td className="px-3 py-2">{r.typeCode || '—'}{r.createsType && <span className="ml-1 text-xs text-ink-3">(new: {r.typeName})</span>}</td>
                        <td className="px-3 py-2">{r.building || '—'}</td>
                        <td className="px-3 py-2">
                          <Pill tone={STATE_META[r.state].tone} size="sm">{STATE_META[r.state].label}</Pill>
                          {r.messages.map((m) => <p key={m} className="mt-1 text-xs text-ink-2">{m}</p>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-ink">Ready to add {importable} {importable === 1 ? 'room' : 'rooms'}</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
                <li>New rooms start as <strong>Vacant dirty</strong> and appear on the Room Board.</li>
                {counts.exists > 0 && <li><strong>{counts.exists}</strong> room{counts.exists === 1 ? '' : 's'} already in your inventory will be skipped. They are not sent, so their status, assignments, history and accessibility features stay exactly as they are.</li>}
                {counts['duplicate-in-file'] > 0 && <li>{counts['duplicate-in-file']} repeated room number{counts['duplicate-in-file'] === 1 ? '' : 's'} in your input will be skipped.</li>}
                {counts.invalid > 0 && <li>{counts.invalid} row{counts.invalid === 1 ? '' : 's'} with problems will not be imported.</li>}
                {newTypeNote && <li>New room types will be created: {classification.newTypes.map((t) => `${t.code} (${t.name})`).join(', ')}.</li>}
              </ul>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2" tabIndex={0} aria-label="Rooms that will be added">
                {classification.rows.filter((r) => r.state === 'new').map((r) => `${r.roomNumber} (floor ${r.floor}, ${r.typeCode}${r.building ? `, ${r.building}` : ''})`).join(' · ')}
              </div>
              {newTypeNote && (
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span>I understand new room types will be created with a default 30-minute cleaning time.</span>
                </label>
              )}
              {submitError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{submitError}</p>}
            </div>
          )}

          {step === 'result' && outcome && (
            <div className="space-y-4" role="status">
              <div className="flex items-center gap-2">
                {outcome.failed.length === 0 ? <CheckCircle2 className="text-[var(--ready)]" size={20} aria-hidden="true" /> : <AlertCircle className="text-[var(--caution)]" size={20} aria-hidden="true" />}
                <h3 className="text-base font-semibold text-ink">{outcome.imported} imported · {outcome.failed.length} failed{counts.exists + counts['duplicate-in-file'] + counts.invalid > 0 ? ` · ${counts.exists + counts['duplicate-in-file'] + counts.invalid} not sent` : ''}</h3>
              </div>
              {outcome.alreadyExisted > 0 && (
                <p role="alert" className="rounded-lg bg-[var(--caution-soft)] px-3 py-2 text-[13px] text-ink">
                  The server reported {outcome.alreadyExisted} room{outcome.alreadyExisted === 1 ? '' : 's'} that already existed, and reset {outcome.alreadyExisted === 1 ? 'its' : 'their'} status to Vacant dirty. This only happens if someone added the same room number after your review — check the Room Board.
                </p>
              )}
              {outcome.failed.length > 0 && (
                <ul className="divide-y divide-line-2 rounded-lg border border-line text-sm">
                  {outcome.failed.map((f, i) => <li key={i} className="px-3 py-2"><span className="font-medium text-ink">Room {f.roomNumber}:</span> <span className="text-ink-2">{f.reason}</span></li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3">
          {step === 'input' && (<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={toReview}>Review rooms</Button></>)}
          {step === 'review' && (<>
            <Button variant="ghost" onClick={() => { setStep('input'); setNotice(null) }}>Back</Button>
            <Button onClick={() => { setNotice(null); setStep('confirm') }} disabled={importable === 0}>
              {importable === 0 ? 'Nothing to import' : `Continue with ${importable} ${importable === 1 ? 'room' : 'rooms'}`}
            </Button>
          </>)}
          {step === 'confirm' && (<>
            <Button variant="ghost" onClick={() => setStep('review')} disabled={busy}>Back</Button>
            <Button onClick={submit} loading={busy} disabled={importable === 0 || (newTypeNote && !acknowledged)}>Import {importable} {importable === 1 ? 'room' : 'rooms'}</Button>
          </>)}
          {step === 'result' && outcome && (<>
            {outcome.failed.length > 0 && <Button variant="outline" onClick={() => { void retryFailed() }}>Retry failed rooms</Button>}
            <Button onClick={onClose}>Done</Button>
          </>)}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
