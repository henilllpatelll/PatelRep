import type { TFunction } from 'i18next'
import { format } from 'date-fns'

// Single source of truth for the 70/40 risk-score thresholds used across
// Assets, Predictions, and the engineering KPI strip. Previously assets/page.tsx
// and predictions/page.tsx each hardcoded these breakpoints with different
// Tailwind classes (assets: blue for low risk; predictions: green) — this
// reconciles both to the app's ink/surface Pill tone system.

export type RiskTier = 'high' | 'medium' | 'low'
export type RiskTone = 'alert' | 'caution' | 'ready'

export function getRiskTier(score: number): RiskTier {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

const RISK_TONE: Record<RiskTier, RiskTone> = {
  high: 'alert',
  medium: 'caution',
  low: 'ready',
}

const RISK_LABEL_KEY: Record<RiskTier, string> = {
  high: 'engineering.failurePrediction.riskHigh',
  medium: 'engineering.failurePrediction.riskMedium',
  low: 'engineering.failurePrediction.riskLow',
}

const RISK_COLOR_CLASS: Record<RiskTone, string> = {
  alert: 'text-[var(--alert)]',
  caution: 'text-[var(--caution)]',
  ready: 'text-[var(--ready)]',
}

const RISK_BORDER_CLASS: Record<RiskTone, string> = {
  alert: 'border-l-[var(--alert)]',
  caution: 'border-l-[var(--caution)]',
  ready: 'border-l-[var(--ready)]',
}

export function getRiskTone(score: number): RiskTone {
  return RISK_TONE[getRiskTier(score)]
}

export function getRiskLabel(score: number, t: TFunction): string {
  return t(RISK_LABEL_KEY[getRiskTier(score)])
}

export function getRiskBadge(score: number, t: TFunction): { label: string; tone: RiskTone } {
  return { label: getRiskLabel(score, t), tone: getRiskTone(score) }
}

export function getRiskColorClass(score: number): string {
  return RISK_COLOR_CLASS[getRiskTone(score)]
}

export function getRiskBorderClass(score: number): string {
  return RISK_BORDER_CLASS[getRiskTone(score)]
}

export function getWarrantyLabel(
  warrantyExpires: string | undefined,
  t: TFunction,
): { text: string; cls: string } {
  if (!warrantyExpires) return { text: t('engineering.assetsPage.noWarranty'), cls: 'text-ink3' }
  const expiry = new Date(warrantyExpires)
  if (expiry < new Date()) {
    return { text: t('engineering.assetsPage.warrantyExpired'), cls: 'text-[var(--alert)] font-medium' }
  }
  return {
    text: t('engineering.assetsPage.warrantyExpires', { date: format(expiry, 'MM/yyyy') }),
    cls: 'text-[var(--ready)]',
  }
}
