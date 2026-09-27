'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { AlertTriangle, Plus, TrendingUp } from 'lucide-react'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { engineeringApi, type EngineeringMeter, type MeterType } from '@/lib/api/engineering'
import { conditionTone, meterPreviewStatus, suggestedUnits } from '@/lib/utils/conditionMonitoring'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EngineeringDrawer } from '@/components/engineering/EngineeringDrawer'
import { useTranslation } from 'react-i18next'

const TYPES: MeterType[] = ['temperature', 'pressure', 'voltage', 'current', 'runtime_hours', 'cycle_count', 'ph', 'chlorine', 'humidity', 'flow', 'energy', 'water', 'custom']
const RANGES = [{ key: '7d', days: 7 }, { key: '30d', days: 30 }, { key: '90d', days: 90 }, { key: '1y', days: 365 }] as const

function numberOrUndefined(value: string) { return value.trim() ? Number(value) : undefined }

export function AssetReadingsPanel({ assetId, canEdit }: { assetId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30d')
  const [addOpen, setAddOpen] = useState(false)
  const [recordOpen, setRecordOpen] = useState(false)
  const metersQuery = useQuery({ queryKey: ['asset-meters', assetId], queryFn: () => engineeringApi.listAssetMeters(assetId), select: (result) => result.data })
  const meters = metersQuery.data ?? []
  const selected = meters.find((meter) => meter.id === selectedId) ?? meters[0] ?? null
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-meters', assetId] })
    queryClient.invalidateQueries({ queryKey: ['asset-condition', assetId] })
    queryClient.invalidateQueries({ queryKey: ['assets'] })
  }

  if (metersQuery.isLoading) return <Skeleton variant="text" className="h-40 w-full" />
  return <section>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">{t('condition.readings')}</p>
        <p className="mt-1 text-sm text-ink2">{t('condition.meterCount', { count: meters.length })}</p>
      </div>
      {canEdit && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setRecordOpen(true)} disabled={!meters.length}>{t('condition.record')}</Button><Button size="sm" onClick={() => setAddOpen(true)}><Plus size={14} />{t('condition.addMeter')}</Button></div>}
    </div>
    {!meters.length ? <div className="mt-4 rounded-[var(--r-sm)] border border-dashed border-line p-5 text-center"><TrendingUp className="mx-auto h-5 w-5 text-ink4" /><p className="mt-2 text-sm font-medium text-ink">{t('condition.noMeters')}</p><p className="mt-1 text-xs text-ink3">{t('condition.noMetersHelp')}</p></div> : <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {meters.map((meter) => <button key={meter.id} type="button" onClick={() => setSelectedId(meter.id)} className={`rounded-[var(--r-sm)] border p-3 text-left transition-colors ${selected?.id === meter.id ? 'border-accent bg-accent-soft/30' : 'border-line hover:bg-surface-2'}`}>
          <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-ink">{meter.name}</p><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${conditionTone(meter.current_status ?? 'no_readings')}`}>{t(`condition.status.${meter.current_status ?? 'no_readings'}`)}</span></div>
          <p className="mt-2 font-display text-xl tabular-nums text-ink">{meter.latest_reading ? `${meter.latest_reading.value} ${meter.unit}` : '—'}</p>
          <p className="mt-1 text-xs text-ink3">{meter.latest_reading ? t('condition.updated', { time: format(new Date(meter.latest_reading.recorded_at), 'MMM d · h:mm a') }) : t('condition.noReadings')}</p>
        </button>)}
      </div>
      {selected && <MeterDetail meter={selected} range={range} onRange={setRange} onRecord={() => setRecordOpen(true)} />}
    </>}
    <AddMeterDrawer open={addOpen} onClose={() => setAddOpen(false)} assetId={assetId} onSaved={() => { invalidate(); setAddOpen(false) }} />
    <RecordReadingDrawer open={recordOpen} onClose={() => setRecordOpen(false)} meters={meters} selectedId={selected?.id ?? null} onSaved={() => { invalidate(); setRecordOpen(false) }} />
  </section>
}

function MeterDetail({ meter, range, onRange, onRecord }: { meter: EngineeringMeter; range: (typeof RANGES)[number]['key']; onRange: (value: (typeof RANGES)[number]['key']) => void; onRecord: () => void }) {
  const { t } = useTranslation()
  const days = RANGES.find((item) => item.key === range)?.days ?? 30
  const readingsQuery = useQuery({ queryKey: ['meter-readings', meter.id, range], queryFn: () => engineeringApi.listMeterReadings(meter.id, { start: subDays(new Date(), days).toISOString(), limit: 500 }), select: (result) => result.data })
  const readings = readingsQuery.data ?? []
  const chartData = useMemo(() => [...readings].reverse().map((reading) => ({ value: reading.value, at: format(new Date(reading.recorded_at), 'MMM d') })), [readings])
  return <div className="mt-6 border-t border-line pt-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-display text-xl text-ink">{meter.name}</p><p className="mt-1 text-sm text-ink2">{t('condition.latest')} <strong className="tabular-nums text-ink">{meter.latest_reading ? `${meter.latest_reading.value} ${meter.unit}` : '—'}</strong></p></div><Button size="sm" variant="outline" onClick={onRecord}>{t('condition.record')}</Button></div>
    <div className="mt-4 flex flex-wrap gap-1">{RANGES.map((item) => <button key={item.key} type="button" onClick={() => onRange(item.key)} className={`min-h-[32px] rounded px-2.5 text-xs font-medium ${range === item.key ? 'bg-ink text-paper' : 'text-ink3 hover:bg-surface-2'}`}>{item.key.toUpperCase()}</button>)}</div>
    <div className="mt-3 h-56 rounded-[var(--r-sm)] border border-line bg-surface-2 p-3">
      {readingsQuery.isLoading ? <Skeleton variant="text" className="h-full w-full" /> : chartData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="at" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={36} /><Tooltip /><Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} /><ReferenceLine y={meter.warning_low ?? undefined} stroke="var(--caution)" strokeDasharray="4 4" /><ReferenceLine y={meter.warning_high ?? undefined} stroke="var(--caution)" strokeDasharray="4 4" /><ReferenceLine y={meter.critical_low ?? undefined} stroke="var(--alert)" strokeDasharray="4 4" /><ReferenceLine y={meter.critical_high ?? undefined} stroke="var(--alert)" strokeDasharray="4 4" /></LineChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-ink3">{t('condition.noReadings')}</p>}
    </div>
    <ol className="mt-5 divide-y divide-line"><p className="pb-2 text-[10px] font-semibold uppercase tracking-[.1em] text-ink3">{t('condition.history')}</p>{readings.slice(0, 10).map((reading) => <li key={reading.id} className="py-3"><div className="flex justify-between gap-3"><div><p className="text-sm font-medium text-ink tabular-nums">{reading.value} {meter.unit} <span className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] uppercase ${conditionTone(reading.status_at_recording)}`}>{t(`condition.status.${reading.status_at_recording}`)}</span></p><p className="mt-1 text-xs text-ink3">{format(new Date(reading.recorded_at), 'MMM d · h:mm a')} · {reading.source.toUpperCase()}</p></div>{reading.work_order?.work_order_number && <p className="text-xs text-ink2">WO-{reading.work_order.work_order_number}</p>}</div></li>)}</ol>
  </div>
}

function AddMeterDrawer({ open, onClose, assetId, onSaved }: { open: boolean; onClose: () => void; assetId: string; onSaved: () => void }) {
  const { t } = useTranslation(); const [name, setName] = useState(''); const [type, setType] = useState<MeterType>('temperature'); const [unit, setUnit] = useState('°F'); const [warningHigh, setWarningHigh] = useState(''); const [criticalHigh, setCriticalHigh] = useState(''); const [warningLow, setWarningLow] = useState(''); const [criticalLow, setCriticalLow] = useState(''); const [stale, setStale] = useState(''); const [automatic, setAutomatic] = useState(false)
  const save = useMutation({ mutationFn: () => engineeringApi.createAssetMeter(assetId, { name, meter_type: type, unit, source_type: 'pm', warning_low: numberOrUndefined(warningLow), warning_high: numberOrUndefined(warningHigh), critical_low: numberOrUndefined(criticalLow), critical_high: numberOrUndefined(criticalHigh), stale_after_hours: numberOrUndefined(stale), critical_action: automatic ? 'create_work_order' : 'none' }), onSuccess: onSaved })
  const units = suggestedUnits(type)
  return <EngineeringDrawer open={open} onClose={onClose} title={t('condition.addMeter')} closeLabel={t('condition.close')} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('condition.cancel')}</Button><Button onClick={() => save.mutate()} disabled={!name.trim() || !unit.trim()} loading={save.isPending}>{t('condition.saveMeter')}</Button></div>}><div className="space-y-4"><label className="block text-sm font-medium text-ink">{t('condition.name')}<Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><label className="block text-sm font-medium text-ink">{t('condition.type')}<select value={type} onChange={(event) => { const value = event.target.value as MeterType; setType(value); setUnit(suggestedUnits(value)[0] ?? '') }} className="mt-1 min-h-[40px] w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm">{TYPES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label className="block text-sm font-medium text-ink">{t('condition.unit')}<Input list="meter-units" value={unit} onChange={(event) => setUnit(event.target.value)} /><datalist id="meter-units">{units.map((value) => <option key={value} value={value} />)}</datalist></label><div className="grid grid-cols-2 gap-3"><Threshold label={t('condition.warningLow')} value={warningLow} setValue={setWarningLow} /><Threshold label={t('condition.warningHigh')} value={warningHigh} setValue={setWarningHigh} /><Threshold label={t('condition.criticalLow')} value={criticalLow} setValue={setCriticalLow} /><Threshold label={t('condition.criticalHigh')} value={criticalHigh} setValue={setCriticalHigh} /></div><label className="block text-sm font-medium text-ink">{t('condition.staleHours')}<Input type="number" min="1" value={stale} onChange={(event) => setStale(event.target.value)} /></label><label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)} className="mt-1" />{t('condition.autoWorkOrder')}</label>{save.error && <p className="text-sm text-alert">{save.error.message}</p>}</div></EngineeringDrawer>
}

function Threshold({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) { return <label className="text-xs font-medium text-ink2">{label}<Input type="number" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></label> }

function RecordReadingDrawer({ open, onClose, meters, selectedId, onSaved }: { open: boolean; onClose: () => void; meters: EngineeringMeter[]; selectedId: string | null; onSaved: () => void }) {
  const { t } = useTranslation(); const [meterId, setMeterId] = useState(selectedId ?? ''); const [value, setValue] = useState(''); const [note, setNote] = useState(''); const meter = meters.find((item) => item.id === meterId) ?? meters[0]; const preview = meter && value.trim() ? meterPreviewStatus(meter, Number(value)) : null
  const save = useMutation({ mutationFn: () => engineeringApi.recordMeterReading(meter!.id, { value: Number(value), notes: note || undefined }), onSuccess: onSaved })
  return <EngineeringDrawer open={open} onClose={onClose} title={t('condition.recordReading')} closeLabel={t('condition.close')} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('condition.cancel')}</Button><Button onClick={() => save.mutate()} disabled={!meter || !value.trim() || Number.isNaN(Number(value))} loading={save.isPending}>{t('condition.saveReading')}</Button></div>}><div className="space-y-4"><label className="block text-sm font-medium text-ink">{t('condition.meter')}<select value={meter?.id ?? ''} onChange={(event) => setMeterId(event.target.value)} className="mt-1 min-h-[40px] w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm">{meters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-sm font-medium text-ink">{t('condition.reading')}<Input type="number" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder={meter?.unit} autoFocus /></label>{preview && <div className={`flex gap-2 rounded-[var(--r-sm)] border p-3 text-sm ${conditionTone(preview)}`}>{preview !== 'normal' && <AlertTriangle size={16} />}{t(`condition.preview.${preview}`)}</div>}<label className="block text-sm font-medium text-ink">{t('condition.note')}<textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-20 w-full rounded-[var(--r-md)] border border-line bg-surface p-3 text-sm" /></label>{save.error && <p className="text-sm text-alert">{save.error.message}</p>}</div></EngineeringDrawer>
}
