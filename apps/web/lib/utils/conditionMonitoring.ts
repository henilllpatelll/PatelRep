import type { MeterType } from '@/lib/api/engineering'

type Thresholds = {
  warning_low?: number | null
  warning_high?: number | null
  critical_low?: number | null
  critical_high?: number | null
}

/** Client preview only; the API records the authoritative status snapshot. */
export function meterPreviewStatus(meter: Thresholds, value: number): 'normal' | 'warning' | 'critical' {
  if (meter.critical_low != null && value <= meter.critical_low) return 'critical'
  if (meter.critical_high != null && value >= meter.critical_high) return 'critical'
  if (meter.warning_low != null && value <= meter.warning_low) return 'warning'
  if (meter.warning_high != null && value >= meter.warning_high) return 'warning'
  return 'normal'
}

export function suggestedUnits(type: MeterType): string[] {
  return {
    temperature: ['°F', '°C'], pressure: ['PSI'], voltage: ['V'], current: ['A'],
    runtime_hours: ['hours'], cycle_count: ['cycles'], ph: ['pH'], chlorine: ['ppm'],
    humidity: ['%'], flow: ['GPM'], energy: ['kWh'], water: ['gal'], custom: [],
  }[type]
}

export function conditionTone(status: string) {
  return status === 'critical' ? 'text-alert bg-alert-soft border-alert-line'
    : status === 'warning' || status === 'stale' ? 'text-caution bg-caution-soft border-caution-line'
      : 'text-ready bg-ready-soft border-ready-line'
}
